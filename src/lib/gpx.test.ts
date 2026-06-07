import { expect, test } from "bun:test";
import { DOMParser } from "linkedom";
import {
  buildSegments,
  calculateElevationChange,
  calculateProfileSlopeDetails,
  calculateProfileSlopeSegments,
  calculateProfileSlopes,
  calculateRouteSpeed,
  calculateSegmentSpeed,
  calculateSlopeDistances,
  DEFAULT_SPEED_MODEL_SETTINGS,
  exportSegmentGpx,
  formatMovingTime,
  formatSpeed,
  getSlopeColor,
  getSlopeName,
  parseGpx,
  type RoutePoint,
  type SpeedModelSettings,
} from "./gpx";

Object.assign(globalThis, {
  DOMParser,
  XMLSerializer: class {
    serializeToString(node: { toString: () => string }) {
      return node.toString();
    }
  },
  document: {
    implementation: {
      createDocument: (_namespace: string, name: string) => new DOMParser().parseFromString(`<${name} />`, "application/xml"),
    },
  },
});

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

const slowSettings: SpeedModelSettings = {
  ...DEFAULT_SPEED_MODEL_SETTINGS,
  powerWatts: 75,
};
const fastSettings: SpeedModelSettings = {
  ...DEFAULT_SPEED_MODEL_SETTINGS,
  powerWatts: 230,
  massKg: 85,
  cda: 0.32,
  crr: 0.0055,
};

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

test("estimates higher flat speed for stronger settings", () => {
  const route = [
    point(0, 100),
    point(10000, 100),
  ];

  const leisure = calculateRouteSpeed(route, slowSettings);
  const racer = calculateRouteSpeed(route, fastSettings);

  expect(racer.averageSpeedMps).toBeGreaterThan(leisure.averageSpeedMps);
  expect(racer.movingTimeSeconds).toBeLessThan(leisure.movingTimeSeconds);
});

test("estimates climbs slower than flats", () => {
  const flat = calculateRouteSpeed([
    point(0, 100),
    point(5000, 100),
  ], DEFAULT_SPEED_MODEL_SETTINGS);
  const climb = calculateRouteSpeed([
    point(0, 100),
    point(5000, 350),
  ], DEFAULT_SPEED_MODEL_SETTINGS);

  expect(climb.averageSpeedMps).toBeLessThan(flat.averageSpeedMps);
  expect(climb.movingTimeSeconds).toBeGreaterThan(flat.movingTimeSeconds);
});

test("clamps steep descent speed to 40 km/h", () => {
  const route = [
    point(0, 500),
    point(5000, 0),
  ];

  expect(calculateRouteSpeed(route, slowSettings).averageSpeedMps).toBeLessThanOrEqual(40 / 3.6);
  expect(calculateRouteSpeed(route, fastSettings).averageSpeedMps).toBeLessThanOrEqual(40 / 3.6);
});

test("estimates segment speed from segment bounds", () => {
  const points = [
    point(0, 100),
    point(1000, 100),
    point(2000, 200),
  ];
  const segments = buildSegments(points, [1]);

  const first = calculateSegmentSpeed(points, segments[0]!, DEFAULT_SPEED_MODEL_SETTINGS);
  const second = calculateSegmentSpeed(points, segments[1]!, DEFAULT_SPEED_MODEL_SETTINGS);

  expect(first.movingTimeSeconds).toBeGreaterThan(0);
  expect(second.movingTimeSeconds).toBeGreaterThan(first.movingTimeSeconds);
});

test("excludes skipped track segment gaps from average speed", () => {
  const oneKilometer = [
    point(0, 100, 0),
    point(1000, 100, 0),
  ];
  const withGap = [
    point(0, 100, 0),
    point(1000, 100, 0),
    point(101000, 100, 1),
    point(102000, 100, 1),
  ];

  const one = calculateRouteSpeed(oneKilometer, DEFAULT_SPEED_MODEL_SETTINGS);
  const gapped = calculateRouteSpeed(withGap, DEFAULT_SPEED_MODEL_SETTINGS);

  expect(gapped.averageSpeedMps).toBeCloseTo(one.averageSpeedMps, 5);
  expect(gapped.movingTimeSeconds).toBeCloseTo(one.movingTimeSeconds * 2, 5);
});

test("excludes skipped track segment gaps from segment speed", () => {
  const points = [
    point(0, 100, 0),
    point(1000, 100, 0),
    point(101000, 100, 1),
    point(102000, 100, 1),
  ];

  const full = calculateSegmentSpeed(points, { start: 0, end: 3 }, DEFAULT_SPEED_MODEL_SETTINGS);
  const first = calculateSegmentSpeed(points, { start: 0, end: 1 }, DEFAULT_SPEED_MODEL_SETTINGS);

  expect(full.averageSpeedMps).toBeCloseTo(first.averageSpeedMps, 5);
  expect(full.movingTimeSeconds).toBeCloseTo(first.movingTimeSeconds * 2, 5);
});

test("formats speed and moving time", () => {
  expect(formatSpeed(10)).toBe("36.0 km/h");
  expect(formatSpeed(0)).toBe("—");
  expect(formatMovingTime(59)).toBe("1m");
  expect(formatMovingTime(3660)).toBe("1h 01m");
});

test("parses GPX waypoints", () => {
  const route = parseGpx(gpxWithWaypoints(), "route.gpx");

  expect(route.waypoints).toHaveLength(2);
  expect(route.waypoints[0]).toMatchObject({
    index: 0,
    lat: 10,
    lon: 20,
    ele: 100,
    time: "2026-01-01T00:00:00Z",
    name: "Start cafe",
    desc: "Coffee stop",
    nearestPointIndex: 0,
  });
  expect(route.waypoints[1]).toMatchObject({
    name: "Finish",
    nearestPointIndex: 2,
  });
});

test("skips waypoints with invalid coordinates", () => {
  const route = parseGpx(`
    <gpx version="1.1" creator="test">
      <wpt lat="bad" lon="20"><name>Bad</name></wpt>
      <wpt lat="10"><name>Missing longitude</name></wpt>
      <wpt lon="20"><name>Missing latitude</name></wpt>
      <trk><trkseg>
        <trkpt lat="10" lon="20" />
        <trkpt lat="10.1" lon="20.1" />
      </trkseg></trk>
    </gpx>
  `, "route.gpx");

  expect(route.waypoints).toHaveLength(0);
});

test("exports only waypoints assigned to the segment", () => {
  const route = parseGpx(gpxWithWaypoints(), "route.gpx");
  const segments = buildSegments(route.points, [1]);

  expect(exportSegmentGpx(route, segments[0]!)).toContain("<name>Start cafe</name>");
  expect(exportSegmentGpx(route, segments[0]!)).not.toContain("<name>Finish</name>");
  expect(exportSegmentGpx(route, segments[1]!)).toContain("<name>Finish</name>");
  expect(exportSegmentGpx(route, segments[1]!)).not.toContain("<name>Start cafe</name>");
});

test("exports a split-point waypoint only once", () => {
  const route = parseGpx(`
    <gpx version="1.1" creator="test">
      <wpt lat="10.1" lon="20.1"><name>Split point</name></wpt>
      <trk><trkseg>
        <trkpt lat="10" lon="20" />
        <trkpt lat="10.1" lon="20.1" />
        <trkpt lat="10.2" lon="20.2" />
      </trkseg></trk>
    </gpx>
  `, "route.gpx");
  const segments = buildSegments(route.points, [1]);

  expect(exportSegmentGpx(route, segments[0]!)).toContain("<name>Split point</name>");
  expect(exportSegmentGpx(route, segments[1]!)).not.toContain("<name>Split point</name>");
});

function gpxWithWaypoints() {
  return `
    <gpx version="1.1" creator="test">
      <wpt lat="10" lon="20">
        <ele>100</ele>
        <time>2026-01-01T00:00:00Z</time>
        <name>Start cafe</name>
        <desc>Coffee stop</desc>
      </wpt>
      <wpt lat="10.2" lon="20.2"><name>Finish</name></wpt>
      <trk><name>Route</name><trkseg>
        <trkpt lat="10" lon="20" />
        <trkpt lat="10.1" lon="20.1" />
        <trkpt lat="10.2" lon="20.2" />
      </trkseg></trk>
    </gpx>
  `;
}
