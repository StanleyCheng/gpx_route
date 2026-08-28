import assert from 'node:assert/strict';
import {
  calculateRecordingSize,
  createMapRecorder,
  isRecordingSupported
} from './route-recorder.mjs';

assert.deepEqual(
  calculateRecordingSize(1280, 800),
  { width: 1280, height: 800 },
  'recordings at or below the output limit should keep their size'
);

assert.deepEqual(
  calculateRecordingSize(3024, 1760),
  { width: 1854, height: 1080 },
  'Retina-sized canvases should be scaled within 1080p'
);

assert.deepEqual(
  calculateRecordingSize(1279, 719),
  { width: 1278, height: 718 },
  'H.264 output dimensions should be even'
);

const globalNames = ['VideoEncoder', 'VideoFrame', 'MediaRecorder', 'HTMLCanvasElement'];
const originalDescriptors = new Map(globalNames.map((name) => [
  name,
  Object.getOwnPropertyDescriptor(globalThis, name)
]));

let stoppedTracks = 0;

class FakeCanvas {
  constructor() {
    this.width = 640;
    this.height = 360;
  }

  captureStream() {
    return {
      getTracks: () => [{ stop: () => { stoppedTracks += 1; } }]
    };
  }
}

class FakeMediaRecorder {
  static lastStartArguments = null;

  static isTypeSupported(mimeType) {
    return mimeType === 'video/webm;codecs=vp9';
  }

  constructor(stream, options) {
    this.stream = stream;
    this.mimeType = options.mimeType;
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onerror = null;
    this.onstop = null;
  }

  start(...args) {
    FakeMediaRecorder.lastStartArguments = args;
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    queueMicrotask(() => {
      this.ondataavailable?.({
        data: new Blob(['valid-video-data'], { type: this.mimeType })
      });
      this.onstop?.();
    });
  }
}

try {
  Object.defineProperty(globalThis, 'VideoEncoder', { value: undefined, configurable: true });
  Object.defineProperty(globalThis, 'VideoFrame', { value: undefined, configurable: true });
  Object.defineProperty(globalThis, 'HTMLCanvasElement', { value: FakeCanvas, configurable: true });
  Object.defineProperty(globalThis, 'MediaRecorder', { value: FakeMediaRecorder, configurable: true });

  assert.equal(isRecordingSupported(), true, 'MediaRecorder should remain a supported fallback');
  const recorder = createMapRecorder(new FakeCanvas(), { routeName: 'Fallback Route' });
  await recorder.start();
  assert.deepEqual(
    FakeMediaRecorder.lastStartArguments,
    [],
    'fallback recording should create one final chunk instead of timed MP4 fragments'
  );
  const result = await recorder.stop();
  assert.equal(result.mimeType, 'video/webm');
  assert.match(result.fileName, /^Fallback-Route-.+\.webm$/);
  assert.equal(stoppedTracks, 1, 'the fallback capture stream should be released');
  URL.revokeObjectURL(result.url);
} finally {
  for (const [name, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
}

console.log('route-recorder tests passed');
