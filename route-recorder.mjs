import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

const MAX_OUTPUT_WIDTH = 1920;
const MAX_OUTPUT_HEIGHT = 1080;
const MAX_ENCODER_QUEUE = 60;
const KEYFRAME_INTERVAL_MICROSECONDS = 2_000_000;
const H264_CODECS = [
  'avc1.42E028', // H.264 constrained baseline, level 4.0
  'avc1.4D4028', // H.264 main, level 4.0
  'avc1.640028', // H.264 high, level 4.0
  'avc1.64002A' // H.264 high, level 4.2
];
const MP4_MIMES = [
  'video/mp4;codecs=avc1.42E01F',
  'video/mp4;codecs=avc1',
  'video/mp4'
];
const WEBM_MIMES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm'
];

const hasWebCodecs = () => Boolean(
  globalThis.VideoEncoder &&
  globalThis.VideoFrame &&
  globalThis.requestAnimationFrame &&
  (globalThis.OffscreenCanvas || globalThis.document)
);

const hasMediaRecorder = () => Boolean(
  globalThis.MediaRecorder &&
  typeof globalThis.HTMLCanvasElement !== 'undefined' &&
  'captureStream' in globalThis.HTMLCanvasElement.prototype
);

export function isRecordingSupported() {
  return hasWebCodecs() || hasMediaRecorder();
}

export function calculateRecordingSize(width, height, {
  maxWidth = MAX_OUTPUT_WIDTH,
  maxHeight = MAX_OUTPUT_HEIGHT
} = {}) {
  const safeWidth = Math.max(2, Number(width) || 0);
  const safeHeight = Math.max(2, Number(height) || 0);
  const scale = Math.min(1, maxWidth / safeWidth, maxHeight / safeHeight);
  return {
    width: Math.max(2, Math.floor(safeWidth * scale / 2) * 2),
    height: Math.max(2, Math.floor(safeHeight * scale / 2) * 2)
  };
}

const mimeBase = (mime) => mime.split(';', 1)[0].trim();

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

const createResult = ({
  blob,
  mimeType,
  routeName,
  durationMs,
  frameCount,
  width,
  height
}) => {
  const baseMime = mimeBase(mimeType);
  const baseName = sanitizeFilename(routeName);
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '');
  return {
    blob,
    url: URL.createObjectURL(blob),
    fileName: `${baseName}-${stamp}.${extensionFor(baseMime)}`,
    mimeType: baseMime,
    durationMs,
    frameCount,
    width,
    height,
    isMp4: baseMime === 'video/mp4'
  };
};

const createEncodingCanvas = (width, height) => {
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(width, height)
    : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('A 2D canvas could not be created for video encoding.');
  return { canvas, context };
};

const pickEncoderConfig = async (width, height, bitrate, framerate) => {
  for (const codec of H264_CODECS) {
    const config = {
      codec,
      width,
      height,
      bitrate,
      framerate,
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: 'realtime',
      avc: { format: 'avc' }
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support?.supported) return config;
    } catch {
      // Try the next H.264 profile.
    }
  }
  return null;
};

const createWebCodecsRecorder = (sourceCanvas, {
  fps,
  bitrate,
  routeName
}) => {
  let muxer = null;
  let encoder = null;
  let encodingCanvas = null;
  let encodingContext = null;
  let captureHandle = 0;
  let recording = false;
  let startMs = 0;
  let lastFrameIndex = -1;
  let lastKeyframeTimestamp = -KEYFRAME_INTERVAL_MICROSECONDS;
  let frameCount = 0;
  let width = 0;
  let height = 0;
  let encoderError = null;

  const cancelCapture = () => {
    if (captureHandle) cancelAnimationFrame(captureHandle);
    captureHandle = 0;
  };

  const releaseEncoder = () => {
    if (encoder) {
      try { encoder.close(); } catch {}
    }
    encoder = null;
    muxer = null;
    encodingCanvas = null;
    encodingContext = null;
  };

  const encodeFrame = (now, force = false) => {
    if (!encoder || !encodingCanvas || !encodingContext) return;
    const elapsedMs = Math.max(0, now - startMs);
    const elapsedFrameIndex = Math.max(0, Math.floor(elapsedMs * fps / 1000));
    const frameIndex = force
      ? Math.max(lastFrameIndex + 1, elapsedFrameIndex)
      : elapsedFrameIndex;
    if (!force && frameIndex <= lastFrameIndex) return;
    if (!force && encoder.encodeQueueSize > MAX_ENCODER_QUEUE) return;
    const timestamp = Math.round(frameIndex * 1_000_000 / fps);
    try {
      encodingContext.drawImage(sourceCanvas, 0, 0, width, height);
      const frame = new VideoFrame(encodingCanvas, {
        timestamp,
        duration: Math.round(1_000_000 / fps)
      });
      const keyFrame = frameCount === 0 ||
        timestamp - lastKeyframeTimestamp >= KEYFRAME_INTERVAL_MICROSECONDS;
      try {
        encoder.encode(frame, { keyFrame });
      } finally {
        frame.close();
      }
      if (keyFrame) lastKeyframeTimestamp = timestamp;
      lastFrameIndex = frameIndex;
      frameCount += 1;
    } catch (error) {
      encoderError = error;
      console.warn('Recorder: frame capture failed:', error);
    }
  };

  const captureFrame = (now) => {
    if (!recording) return;
    encodeFrame(now);
    if (recording) captureHandle = requestAnimationFrame(captureFrame);
  };

  const start = async () => {
    if (recording) return;
    if (sourceCanvas.width < 2 || sourceCanvas.height < 2) {
      throw new Error('The map canvas is not ready to record.');
    }
    ({ width, height } = calculateRecordingSize(sourceCanvas.width, sourceCanvas.height));
    const config = await pickEncoderConfig(width, height, bitrate, fps);
    if (!config) throw new Error('No compatible H.264 encoder was found for this display size.');
    ({ canvas: encodingCanvas, context: encodingContext } = createEncodingCanvas(width, height));
    muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width, height, frameRate: fps },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'strict'
    });
    encoderError = null;
    encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (error) => {
        encoderError = error;
        console.error('Recorder: H.264 encoder failed:', error);
      }
    });
    try {
      encoder.configure(config);
    } catch (error) {
      releaseEncoder();
      throw new Error(`H.264 encoder rejected the configuration: ${error.message}`);
    }
    frameCount = 0;
    lastFrameIndex = -1;
    lastKeyframeTimestamp = -KEYFRAME_INTERVAL_MICROSECONDS;
    startMs = performance.now();
    recording = true;
    encodeFrame(startMs, true);
    captureHandle = requestAnimationFrame(captureFrame);
  };

  const stop = async () => {
    if (!recording || !encoder || !muxer) return null;
    recording = false;
    cancelCapture();
    const durationMs = performance.now() - startMs;
    encodeFrame(performance.now(), true);
    // A final adjacent sample gives players an exact duration for the last frame.
    encodeFrame(performance.now(), true);
    const activeEncoder = encoder;
    const activeMuxer = muxer;
    try {
      await activeEncoder.flush();
      if (encoderError) throw encoderError;
      activeMuxer.finalize();
      const blob = new Blob([activeMuxer.target.buffer], { type: 'video/mp4' });
      if (!blob.size || frameCount < 2) return null;
      return createResult({
        blob,
        mimeType: 'video/mp4',
        routeName,
        durationMs,
        frameCount,
        width,
        height
      });
    } finally {
      releaseEncoder();
    }
  };

  const discard = () => {
    recording = false;
    cancelCapture();
    releaseEncoder();
    frameCount = 0;
  };

  return { start, stop, discard, isRecording: () => recording, codecLabel: 'video/mp4' };
};

const isSafari = () => globalThis.navigator?.vendor === 'Apple Computer, Inc.';

const pickMediaRecorderMime = () => {
  const candidates = isSafari()
    ? [...MP4_MIMES, ...WEBM_MIMES]
    : [...WEBM_MIMES, ...MP4_MIMES];
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) || null;
};

const createMediaRecorderFallback = (canvas, {
  fps,
  bitrate,
  routeName
}) => {
  let stream = null;
  let recorder = null;
  let chunks = [];
  let recording = false;
  let startMs = 0;
  let recorderError = null;
  let mimeType = '';

  const releaseStream = () => {
    if (!stream) return;
    try {
      for (const track of stream.getTracks()) track.stop();
    } catch {}
    stream = null;
  };

  const start = async () => {
    if (recording) return;
    mimeType = pickMediaRecorderMime();
    if (!mimeType) throw new Error('No supported fallback video format was found.');
    chunks = [];
    recorderError = null;
    startMs = performance.now();
    stream = canvas.captureStream(fps);
    try {
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
    } catch (error) {
      releaseStream();
      throw new Error(`Fallback recorder rejected the configuration: ${error.message}`);
    }
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };
    recorder.onerror = (event) => {
      recorderError = event.error || new Error('The fallback video encoder failed.');
    };
    try {
      // A single final chunk avoids Chromium's malformed fragmented-MP4 timing.
      recorder.start();
      recording = true;
    } catch (error) {
      releaseStream();
      recorder = null;
      throw new Error(`Fallback recorder failed to start: ${error.message}`);
    }
  };

  const stop = async () => {
    if (!recording || !recorder) return null;
    recording = false;
    const durationMs = performance.now() - startMs;
    const activeRecorder = recorder;
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        resolve();
      };
      const guard = setTimeout(finish, 3000);
      activeRecorder.onstop = finish;
      try { activeRecorder.stop(); } catch { finish(); }
    });
    releaseStream();
    recorder = null;
    if (recorderError) throw recorderError;
    if (!chunks.length) return null;
    const baseMime = mimeBase(activeRecorder.mimeType || mimeType);
    const blob = new Blob(chunks, { type: baseMime });
    if (!blob.size) return null;
    return createResult({
      blob,
      mimeType: baseMime,
      routeName,
      durationMs,
      frameCount: chunks.length,
      width: canvas.width,
      height: canvas.height
    });
  };

  const discard = () => {
    recording = false;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch {}
    }
    recorder = null;
    chunks = [];
    releaseStream();
  };

  return {
    start,
    stop,
    discard,
    isRecording: () => recording,
    get codecLabel() { return mimeBase(mimeType || 'video'); }
  };
};

export function createMapRecorder(canvas, {
  fps = 30,
  bitrate = 5_000_000,
  routeName = ''
} = {}) {
  if (!canvas) throw new Error('A map canvas is required for recording.');
  if (!isRecordingSupported()) {
    throw new Error('This browser cannot record the map. Try Safari 16.4+, Chrome, or Edge.');
  }
  let backend = null;
  let recording = false;

  const options = { fps, bitrate, routeName };
  const start = async () => {
    if (recording) return;
    let webCodecsError = null;
    if (hasWebCodecs()) {
      backend = createWebCodecsRecorder(canvas, options);
      try {
        await backend.start();
        recording = true;
        return;
      } catch (error) {
        webCodecsError = error;
        backend.discard();
        backend = null;
        console.warn('Recorder: WebCodecs unavailable, trying fallback:', error);
      }
    }
    if (hasMediaRecorder() && typeof canvas.captureStream === 'function') {
      backend = createMediaRecorderFallback(canvas, options);
      await backend.start();
      recording = true;
      return;
    }
    throw webCodecsError || new Error('No compatible video encoder is available.');
  };

  const stop = async () => {
    if (!recording || !backend) return null;
    recording = false;
    return backend.stop();
  };

  const discard = () => {
    recording = false;
    if (backend) backend.discard();
    backend = null;
  };

  return {
    start,
    stop,
    discard,
    isRecording: () => recording,
    get codecLabel() { return backend?.codecLabel || 'video/mp4'; }
  };
}

export const recorderFeatures = Object.freeze({
  VideoEncoder: typeof globalThis.VideoEncoder,
  VideoFrame: typeof globalThis.VideoFrame,
  MediaRecorder: typeof globalThis.MediaRecorder,
  captureStream: typeof globalThis.HTMLCanvasElement !== 'undefined' &&
    'captureStream' in globalThis.HTMLCanvasElement.prototype
});
