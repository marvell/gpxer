import { expect, test } from "bun:test";
import { calculateElevationChange, type RoutePoint } from "./gpx";

function point(distance: number, ele: number | null, sourceSegment = 0): RoutePoint {
  return {
    index: distance,
    lat: 0,
    lon: 0,
    ele,
    time: null,
    distance,
    sourceSegment,
    trkpt: {} as Element,
  };
}

test("filters small elevation noise", () => {
  const rawGain = 5;
  const result = calculateElevationChange([
    point(0, 100),
    point(25, 101),
    point(50, 100),
    point(75, 102),
    point(100, 101),
    point(125, 103),
  ]);

  expect(result.ascent).toBeLessThan(rawGain);
  expect(result.descent).toBeLessThan(2);
});

test("counts larger climbs and descents", () => {
  const result = calculateElevationChange([
    point(0, 100),
    point(100, 180),
    point(200, 120),
  ]);

  expect(result.ascent).toBeCloseTo(80, 5);
  expect(result.descent).toBeCloseTo(60, 5);
});

test("treats missing elevation as zero in the smoothing window", () => {
  const result = calculateElevationChange([
    point(0, 100),
    point(100, null),
    point(200, 120),
  ]);

  expect(result.ascent).toBeCloseTo(46.6666666667, 5);
  expect(result.descent).toBeCloseTo(26.6666666667, 5);
});
