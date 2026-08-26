import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const bundle = async (options) => {
  const result = await build({
    bundle: true,
    format: 'iife',
    minify: true,
    target: ['safari16.4'],
    write: false,
    ...options
  });
  return result.outputFiles[0].text.replaceAll('</script', '<\\/script');
};

const fitSdkBundle = await bundle({
  stdin: {
    contents: "export { Decoder, Stream, Utils } from '@garmin/fitsdk';",
    resolveDir: process.cwd()
  },
  format: 'esm'
});
const routeCoreBundle = await bundle({
  entryPoints: ['route-core.mjs'],
  globalName: 'RouteCore'
});
const html = (await readFile('index.html', 'utf8'))
  .replace('__ROUTE_CORE_BUNDLE__', routeCoreBundle);
const pagesHtml = html
  .replaceAll('__SITE_ORIGIN__', 'https://stanleycheng.github.io/gpx_route')
  .replaceAll('__MAPTILER_KEY__', '')
  .replace('href="/favicon.png', 'href="./favicon.png')
  .replace('href="/apple-touch-icon.png', 'href="./apple-touch-icon.png')
  .replace("import('/fit-sdk.js')", "import('./fit-sdk.js')");
const socialImage = (await readFile('public/og.png')).toString('base64');
const faviconImage = (await readFile('public/favicon.png')).toString('base64');
const appleTouchIcon = (await readFile('public/apple-touch-icon.png')).toString('base64');
const worker = `
const html = ${JSON.stringify(html)};
const fitSdkBundle = ${JSON.stringify(fitSdkBundle)};
const socialImage = Uint8Array.from(atob(${JSON.stringify(socialImage)}), character => character.charCodeAt(0));
const faviconImage = Uint8Array.from(atob(${JSON.stringify(faviconImage)}), character => character.charCodeAt(0));
const appleTouchIcon = Uint8Array.from(atob(${JSON.stringify(appleTouchIcon)}), character => character.charCodeAt(0));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/fit-sdk.js') {
      return new Response(fitSdkBundle, {
        headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=604800' }
      });
    }
    if (url.pathname === '/og.png') {
      return new Response(socialImage, {
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' }
      });
    }
    if (url.pathname === '/favicon.png') {
      return new Response(faviconImage, {
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800' }
      });
    }
    if (url.pathname === '/apple-touch-icon.png') {
      return new Response(appleTouchIcon, {
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=604800' }
      });
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(
        html
          .replaceAll('__SITE_ORIGIN__', url.origin)
          .replaceAll('__MAPTILER_KEY__', encodeURIComponent(env.MAPTILER_KEY || '')),
        {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-cache',
          'referrer-policy': 'strict-origin-when-cross-origin',
          'x-content-type-options': 'nosniff'
        }
      });
    }
    return new Response('Not found', { status: 404 });
  }
};
`;

await rm('dist', { recursive: true, force: true });
await rm('docs', { recursive: true, force: true });
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await mkdir('docs', { recursive: true });
await writeFile('dist/server/index.js', worker);
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
await writeFile('docs/index.html', pagesHtml);
await writeFile('docs/fit-sdk.js', fitSdkBundle);
await writeFile('docs/.nojekyll', '');
await Promise.all(['og.png', 'favicon.png', 'apple-touch-icon.png']
  .map((file) => copyFile(`public/${file}`, `docs/${file}`)));
