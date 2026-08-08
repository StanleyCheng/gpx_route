import assert from 'node:assert/strict';
import {
  MAX_ALLOWED_SPEED_KILOMETERS_PER_HOUR,
  MAX_ALLOWED_SPEED_METERS_PER_SECOND,
  GPS_SPEED_FILTER_ENABLED,
  filterGpsSpikes,
  normalizePointTimes,
  prepareTrack
} from './route-core.mjs';

const start = { lat: 22.3, lon: 114.17, time: 0 };
const spike = { lat: 22.31, lon: 114.18, time: 1000 };
const recovery = { lat: 22.30001, lon: 114.17001, time: 2000 };
const filtered = filterGpsSpikes([start, spike, recovery], MAX_ALLOWED_SPEED_METERS_PER_SECOND);

assert.equal(MAX_ALLOWED_SPEED_KILOMETERS_PER_HOUR, 150);
assert.equal(GPS_SPEED_FILTER_ENABLED, false);
assert.deepEqual(filtered.points, [start, recovery]);
assert.equal(filtered.removedPoints, 1);
assert.equal(prepareTrack([start, spike, recovery]).removedPoints, 0);

const missingTime = { lat: 22.30002, lon: 114.17002, time: Number.NaN };
assert.equal(filterGpsSpikes([start, missingTime, recovery]).points.length, 3);

const normalized = normalizePointTimes([
  { ...start, time: Number.NaN },
  { ...recovery, time: 5000 },
  { ...recovery, time: 5000 }
]);
assert.deepEqual(normalized.map((point) => point.time), [4000, 5000, 6000]);
assert.equal(prepareTrack([start, recovery]).startTime, 0);
assert.equal(prepareTrack([start, recovery]).rawPointCount, 2);

console.log('Route filtering tests passed.');
