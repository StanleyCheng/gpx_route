const PREFERRED_MIMES = [
  'video/mp4;codecs=avc1.42E01F', // H.264 Constrained Baseline 3.1 (Safari)
  'video/mp4;codecs=avc1',        // Generic H.264 in MP4 (Safari)
  'video/mp4',                    // Any MP4 (Safari)
  'video/webm;codecs=vp9',        // VP9 in WebM (Chrome)
  'video/webm;codecs=vp8',        // VP8 in WebM (Chrome/Firefox)
  'video/webm'                    // Any WebM
];

const FEATURES = typeof globalThis !== 'undefined' ? {
  MediaRecorder: typeof globalThis.MediaRecorder,
  captureStream: typeof globalThis.HTMLCanvasElement !== 'undefined'
    && 'captureStream' in globalThis.HTMLCanvasElement.prototype
} : null;

export function isRecordingSupported() {
  return Boolean(
    globalThis.MediaRecorder &&
    typeof globalThis.HTMLCanvasElement !== 'undefined' &&
    'captureStream' in globalThis.HTMLCanvasElement.prototype
  );
}

const pickMimeType = () => {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mime of PREFERRED_MIMES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : null;
};

const mimeBase = (mime) => {
  const semi = mime.indexOf(';');
  return (semi >= 0 ? mime.slice(0, semi) : mime).trim();
};

const extensionFor = (mime) => {
  const base = mimeBase(mime);
  if (base === 'video/mp4') return 'mp4';
  if (base === 'video/webm') return 'webm';
  return 'bin';
};

const sanitizeFilename = (name) =>
  String(name || 'route-replay')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9_\-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'route-replay';

export function createMapRecorder(canvas, {
  fps = 30,
  bitrate = 5_000_000,
  routeName = ''
} = {}) {
  if (!isRecordingSupported()) {
    throw new Error('This browser cannot record the map. Try Safari 16.4+, Chrome, or Edge.');
  }
  const mimeType = pickMimeType();
  if (!mimeType) {
    throw new Error('No supported video MIME type was found for this browser.');
  }

  let stream = null;
  let recorder = null;
  let chunks = [];
  let recording = false;
  let startMs = 0;
  let dataChunks = 0;
  let pendingStop = null;

  const releaseStream = () => {
    if (!stream) return;
    try {
      for (const track of stream.getTracks()) track.stop();
    } catch {}
    stream = null;
  };

  const start = async () => {
    if (recording) return;
    chunks = [];
    dataChunks = 0;
    startMs = performance.now();
    stream = canvas.captureStream(fps);
    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: bitrate
      });
    } catch (error) {
      releaseStream();
      throw new Error(`MediaRecorder rejected the configuration: ${error.message}`);
    }
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
        dataChunks += 1;
      }
    };
    recorder.onerror = (event) => {
      console.error('MediaRecorder error:', event.error || event);
    };
    recorder.onstop = () => {
      const resolve = pendingStop;
      pendingStop = null;
      if (resolve) resolve();
    };
    try {
      recorder.start(250);
      recording = true;
    } catch (error) {
      releaseStream();
      recorder = null;
      throw new Error(`MediaRecorder failed to start: ${error.message}`);
    }
  };

  const stop = async () => {
    if (!recording || !recorder) return null;
    recording = false;
    const baseMime = mimeBase(mimeType);
    const elapsedMs = performance.now() - startMs;
    const inst = recorder;
    try {
      await new Promise((resolve) => {
        pendingStop = resolve;
        const guard = setTimeout(() => {
          if (pendingStop === resolve) {
            pendingStop = null;
            resolve();
          }
        }, 3000);
        pendingStop = () => { clearTimeout(guard); resolve(); };
        try {
          if (inst.state === 'recording' || inst.state === 'paused') inst.stop();
          else { clearTimeout(guard); resolve(); }
        } catch {
          clearTimeout(guard);
          resolve();
        }
      });
    } catch {}
    releaseStream();
    recorder = null;
    if (!chunks.length) return null;
    const blob = new Blob(chunks, { type: baseMime });
    if (blob.size === 0) return null;
    const baseName = sanitizeFilename(routeName);
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '');
    const fileName = `${baseName}-${stamp}.${extensionFor(mimeType)}`;
    return {
      blob,
      url: URL.createObjectURL(blob),
      fileName,
      mimeType: baseMime,
      durationMs: elapsedMs,
      frameCount: dataChunks,
      width: canvas.width,
      height: canvas.height,
      isMp4: baseMime === 'video/mp4'
    };
  };

  const discard = () => {
    if (!recording && !recorder) return;
    recording = false;
    if (recorder) {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {}
      recorder = null;
    }
    chunks = [];
    releaseStream();
  };

  const isRecording = () => recording;

  return { start, stop, discard, isRecording, codecLabel: mimeBase(mimeType) };
}

export const recorderFeatures = FEATURES;
