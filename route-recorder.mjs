import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

const FEATURES = typeof globalThis !== 'undefined' && {
  VideoEncoder: typeof globalThis.VideoEncoder,
  VideoFrame: typeof globalThis.VideoFrame,
  EncodedVideoChunk: typeof globalThis.EncodedVideoChunk
};

export function isRecordingSupported() {
  return Boolean(
    globalThis.VideoEncoder &&
    globalThis.VideoFrame &&
    globalThis.EncodedVideoChunk
  );
}

const SUPPORTED_CODECS = [
  'avc1.42E01F', // H.264 baseline 3.1 — most compatible
  'avc1.4D401F', // H.264 main 3.1
  'avc1.640028'  // H.264 high 4.0
];

const pickCodec = (width, height, bitrate, framerate) => {
  for (const codec of SUPPORTED_CODECS) {
    const support = VideoEncoder.isConfigSupported({
      codec, width, height, bitrate, framerate
    });
    if (support && support.supported) return codec;
  }
  return null;
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
    throw new Error('This browser cannot record video. Try Safari 16.4+, Chrome, or Edge.');
  }

  let muxer = null;
  let encoder = null;
  let captureHandle = 0;
  let recording = false;
  let startMs = 0;
  let frameCount = 0;
  let width = canvas.width;
  let height = canvas.height;
  let codec = null;

  const start = async () => {
    if (recording) return;
    width = canvas.width;
    height = canvas.height;
    codec = pickCodec(width, height, bitrate, fps);
    if (!codec) {
      throw new Error('No supported H.264 encoder configuration was found for this canvas.');
    }
    muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width, height, frameRate: fps },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset'
    });
    encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (error) => console.error('VideoEncoder:', error)
    });
    encoder.configure({ codec, width, height, bitrate, framerate: fps });
    frameCount = 0;
    startMs = performance.now();
    recording = true;
    captureHandle = requestAnimationFrame(captureFrame);
  };

  const captureFrame = (now) => {
    if (!recording) return;
    try {
      if (encoder && encoder.encodeQueueSize <= 12) {
        const timestamp = (now - startMs) * 1000;
        const frame = new VideoFrame(canvas, { timestamp });
        encoder.encode(frame, { keyFrame: frameCount % (fps * 2) === 0 });
        frame.close();
        frameCount += 1;
      }
    } catch (error) {
      console.warn('Recorder: frame capture failed:', error);
    }
    if (recording) captureHandle = requestAnimationFrame(captureFrame);
  };

  const stop = async () => {
    if (!recording) return null;
    recording = false;
    if (captureHandle) {
      cancelAnimationFrame(captureHandle);
      captureHandle = 0;
    }
    if (!encoder || !muxer) return null;
    const durationMs = performance.now() - startMs;
    const elapsedFrameCount = frameCount;
    try {
      await encoder.flush();
      muxer.finalize();
      const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      const baseName = sanitizeFilename(routeName);
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '');
      const fileName = `${baseName}-${stamp}.mp4`;
      return {
        blob,
        url,
        fileName,
        mimeType: 'video/mp4',
        durationMs,
        frameCount: elapsedFrameCount,
        width,
        height
      };
    } catch (error) {
      console.error('Recorder: finalize failed:', error);
      return null;
    } finally {
      encoder = null;
      muxer = null;
      frameCount = 0;
    }
  };

  const discard = () => {
    if (!recording) return;
    recording = false;
    if (captureHandle) {
      cancelAnimationFrame(captureHandle);
      captureHandle = 0;
    }
    encoder = null;
    muxer = null;
    frameCount = 0;
  };

  const isRecording = () => recording;

  return { start, stop, discard, isRecording };
}

export const recorderFeatures = FEATURES;
