export const FASTEST_ALLOWED_PACE_SECONDS_PER_KM = 30;
export const MAX_ALLOWED_SPEED_METERS_PER_SECOND = 1000 / FASTEST_ALLOWED_PACE_SECONDS_PER_KM;

export function haversine(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(x));
}

export function filterGpsSpikes(rawPoints, maxSpeed = MAX_ALLOWED_SPEED_METERS_PER_SECOND) {
  const points = [];
  let removedPoints = 0;
  let lastTimedPoint = null;

  for (const point of rawPoints) {
    const timestamp = Number(point.time);
    const canMeasureSpeed = lastTimedPoint &&
      Number.isFinite(timestamp) &&
      timestamp > lastTimedPoint.time;

    if (canMeasureSpeed) {
      const elapsedSeconds = (timestamp - lastTimedPoint.time) / 1000;
      if (haversine(lastTimedPoint, point) / elapsedSeconds > maxSpeed) {
        removedPoints += 1;
        continue;
      }
    }

    points.push(point);
    if (Number.isFinite(timestamp) && (!lastTimedPoint || timestamp > lastTimedPoint.time)) {
      lastTimedPoint = { ...point, time: timestamp };
    }
  }

  return { points, removedPoints };
}

export function normalizePointTimes(points) {
  const firstTimedIndex = points.findIndex((point) => Number.isFinite(Number(point.time)));
  const firstTime = firstTimedIndex >= 0 ? Number(points[firstTimedIndex].time) : 0;
  let previousTime = firstTime - (firstTimedIndex + 1) * 1000;

  return points.map((point) => {
    const candidate = Number(point.time);
    const time = Number.isFinite(candidate) && candidate > previousTime
      ? candidate
      : previousTime + 1000;
    previousTime = time;
    return { ...point, time };
  });
}

export function prepareTrack(rawPoints) {
  const filtered = filterGpsSpikes(rawPoints);
  if (filtered.points.length < 2) {
    throw new Error('The route needs at least two usable track points after GPS spike filtering.');
  }
  return {
    points: normalizePointTimes(filtered.points),
    rawPointCount: rawPoints.length,
    removedPoints: filtered.removedPoints
  };
}
