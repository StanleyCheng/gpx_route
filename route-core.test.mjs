import assert from 'node:assert/strict';
import {
  FASTEST_ALLOWED_PACE_SECONDS_PER_KM,
  filterGpsSpikes,
  normalizePointTimes,
  prepareTrack
} from './route-core.mjs';

const start = { lat: 22.3, lon: 114.17, time: 0 };
const spike = { lat: 22.31, lon: 114.18, time: 1000 };
const recovery = { lat: 22.30001, lon: 114.17001, time: 2000 };
const filtered = filterGpsSpikes([start, spike, recovery]);

assert.equal(FASTEST_ALLOWED_PACE_SECONDS_PER_KM, 210);
assert.deepEqual(filtered.points, [start, recovery]);
assert.equal(filtered.removedPoints, 1);

const missingTime = { lat: 22.30002, lon: 114.17002, time: Number.NaN };
assert.equal(filterGpsSpikes([start, missingTime, recovery]).points.length, 3);

const normalized = normalizePointTimes([
  { ...start, time: Number.NaN },
  { ...recovery, time: 5000 },
  { ...recovery, time: 5000 }
]);
assert.deepEqual(normalized.map((point) => point.time), [4000, 5000, 6000]);
assert.equal(prepareTrack([start, recovery]).rawPointCount, 2);

console.log('Route filtering tests passed.');
