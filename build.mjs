import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const html = await readFile('index.html', 'utf8');
const socialImage = (await readFile('public/og.png')).toString('base64');
const worker = `
const html = ${JSON.stringify(html)};
const socialImage = Uint8Array.from(atob(${JSON.stringify(socialImage)}), character => character.charCodeAt(0));

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/og.png') {
      return new Response(socialImage, {
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' }
      });
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(html.replaceAll('__SITE_ORIGIN__', url.origin), {
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
await mkdir('dist/server', { recursive: true });
await writeFile('dist/server/index.js', worker);
