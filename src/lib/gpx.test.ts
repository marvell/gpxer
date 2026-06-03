import { expect, test } from "bun:test";
import { calculateElevationChange, calculateProfileSlopeDetails, calculateProfileSlopeSegments, calculateProfileSlopes, calculateSlopeDistances, getSlopeColor, getSlopeName, type RoutePoint } from "./gpx";

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

test("uses app-friendly slope colors", () => {
  expect(getSlopeColor(-20)).toBe("#15803d");
  expect(getSlopeColor(-8)).toBe("#22c55e");
  expect(getSlopeColor(-2)).toBe("#86efac");
  expect(getSlopeColor(0)).toBe("#d9f99d");
  expect(getSlopeColor(2)).toBe("#fde047");
  expect(getSlopeColor(5)).toBe("#fb923c");
  expect(getSlopeColor(8)).toBe("#ef4444");
  expect(getSlopeColor(20)).toBe("#991b1b");
  expect(getSlopeColor(30)).toBe(getSlopeColor(20));
  expect(getSlopeColor(-30)).toBe(getSlopeColor(-20));
  expect(getSlopeColor(10)).not.toBe(getSlopeColor(-10));
});

test("names slope categories", () => {
  expect(getSlopeName(-20)).toBe("steep downhill");
  expect(getSlopeName(-8)).toBe("downhill");
  expect(getSlopeName(-2)).toBe("gentle downhill");
  expect(getSlopeName(0)).toBe("flat");
  expect(getSlopeName(2)).toBe("false flat");
  expect(getSlopeName(5)).toBe("climb");
  expect(getSlopeName(8)).toBe("hard climb");
  expect(getSlopeName(20)).toBe("steep climb");
});

test("calculates profile slopes from simplified elevation spans", () => {
  const slopes = calculateProfileSlopes([
    point(0, 100),
    point(100, 110),
    point(200, 140),
  ]);

  expect(slopes).toEqual([20, 20, 20]);
});

test("calculates profile slope distances", () => {
  const details = calculateProfileSlopeDetails([
    point(0, 100),
    point(100, 120),
  ]);

  expect(details).toEqual([
    { slope: 20, distance: 100 },
    { slope: 20, distance: 100 },
  ]);
});

test("returns simplified profile slope segments", () => {
  const segments = calculateProfileSlopeSegments([
    point(0, 100),
    point(100, 110),
    point(200, 140),
  ]);

  expect(segments).toEqual([{ start: 0, end: 2, slope: 20, distance: 200 }]);
});

test("sums profile slope distances by category", () => {
  const distances = calculateSlopeDistances([
    point(0, 100),
    point(1000, 120),
    point(2000, 300),
    point(3000, 320),
  ]);

  expect(distances.find(item => item.label === "+1..+4%")?.distance).toBe(2000);
  expect(distances.find(item => item.label === "> +10%")?.distance).toBe(1000);
});
