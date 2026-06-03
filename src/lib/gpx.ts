export type RoutePoint = {
  index: number;
  lat: number;
  lon: number;
  ele: number | null;
  time: string | null;
  distance: number;
  sourceSegment: number;
  trkpt: Element;
};

export type RouteData = {
  name: string;
  fileName: string;
  document: Document;
  points: RoutePoint[];
  totalDistance: number;
  ascent: number;
  descent: number;
  bounds: [[number, number], [number, number]];
};

export type Segment = {
  id: number;
  start: number;
  end: number;
  name: string;
  distance: number;
  ascent: number;
  descent: number;
  minEle: number | null;
  maxEle: number | null;
  points: number;
};

const GPX_NAMESPACE = "http://www.topografix.com/GPX/1/1";

export function parseGpx(text: string, fileName: string): RouteData {
  const parser = new DOMParser();
  const document = parser.parseFromString(text, "application/xml");
  const error = document.querySelector("parsererror");
  if (error) throw new Error("GPX file is not valid XML.");

  const sourceSegments = [...document.querySelectorAll("trkseg")].map((trkseg, sourceSegment) => ({
    sourceSegment,
    trkpts: [...trkseg.querySelectorAll("trkpt")],
  }));
  const trkpts = sourceSegments.flatMap(segment => segment.trkpts);
  if (trkpts.length < 2) throw new Error("GPX file must contain at least two track points.");

  let distance = 0;
  const points: RoutePoint[] = [];
  const bounds: [[number, number], [number, number]] = [
    [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  ];

  for (const { sourceSegment, trkpts } of sourceSegments) {
    for (const trkpt of trkpts) {
      const lat = Number(trkpt.getAttribute("lat"));
      const lon = Number(trkpt.getAttribute("lon"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const eleText = trkpt.querySelector("ele")?.textContent;
      const ele = eleText === undefined || eleText === null || eleText === "" ? null : Number(eleText);
      const cleanEle = ele !== null && Number.isFinite(ele) ? ele : null;
      const previous = points.at(-1);
      if (previous) distance += haversine(previous.lat, previous.lon, lat, lon);

      bounds[0][0] = Math.min(bounds[0][0], lon);
      bounds[0][1] = Math.min(bounds[0][1], lat);
      bounds[1][0] = Math.max(bounds[1][0], lon);
      bounds[1][1] = Math.max(bounds[1][1], lat);

      points.push({
        index: points.length,
        lat,
        lon,
        ele: cleanEle,
        time: trkpt.querySelector("time")?.textContent ?? null,
        distance,
        sourceSegment,
        trkpt,
      });
    }
  }

  if (points.length < 2) throw new Error("GPX file has no usable track points.");
  const elevation = calculateElevationChangeBySourceSegment(points);

  return {
    name: document.querySelector("trk > name, metadata > name, name")?.textContent?.trim() || baseName(fileName),
    fileName,
    document,
    points,
    totalDistance: distance,
    ascent: elevation.ascent,
    descent: elevation.descent,
    bounds,
  };
}

export function buildSegments(points: RoutePoint[], splitIndexes: number[]): Segment[] {
  const cuts = [0, ...splitIndexes.filter(index => index > 0 && index < points.length - 1).sort((a, b) => a - b), points.length - 1];

  return cuts.slice(0, -1).map((start, id) => {
    const end = cuts[id + 1]!;
    const slice = points.slice(start, end + 1);
    const { ascent, descent } = calculateElevationChangeBySourceSegment(slice);
    let minEle: number | null = null;
    let maxEle: number | null = null;

    for (let index = 0; index < slice.length; index++) {
      const point = slice[index]!;
      if (point.ele !== null) {
        minEle = minEle === null ? point.ele : Math.min(minEle, point.ele);
        maxEle = maxEle === null ? point.ele : Math.max(maxEle, point.ele);
      }
    }

    return {
      id: id + 1,
      start,
      end,
      name: `Segment ${id + 1}`,
      distance: points[end]!.distance - points[start]!.distance,
      ascent,
      descent,
      minEle,
      maxEle,
      points: slice.length,
    };
  });
}

export function exportSegmentGpx(route: RouteData, segment: Segment): string {
  const serializer = new XMLSerializer();
  const doc = document.implementation.createDocument(GPX_NAMESPACE, "gpx");
  const root = doc.documentElement;
  root.setAttribute("version", route.document.documentElement.getAttribute("version") || "1.1");
  root.setAttribute("creator", "gpxsplit");

  const trk = doc.createElementNS(GPX_NAMESPACE, "trk");
  const name = doc.createElementNS(GPX_NAMESPACE, "name");
  name.textContent = `${route.name} - ${segment.name}`;
  const trkseg = doc.createElementNS(GPX_NAMESPACE, "trkseg");

  route.points.slice(segment.start, segment.end + 1).forEach(point => {
    trkseg.appendChild(doc.importNode(point.trkpt, true));
  });

  trk.append(name, trkseg);
  root.appendChild(trk);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serializer.serializeToString(doc)}\n`;
}

export function downloadText(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/gpx+xml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function nearestPoint(points: RoutePoint[], distanceKm: number) {
  const target = distanceKm * 1000;

  if (points.length === 0) return 0;
  if (target <= points[0]!.distance) return points[0]!.index;
  if (target >= points.at(-1)!.distance) return points.at(-1)!.index;

  let low = 0;
  let high = points.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid]!.distance < target) low = mid + 1;
    else high = mid;
  }

  const before = points[low - 1]!;
  const after = points[low]!;
  return target - before.distance <= after.distance - target ? before.index : after.index;
}

export function formatDistance(meters: number) {
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatElevation(meters: number | null) {
  return meters === null ? "—" : `${Math.round(meters)} m`;
}

export function safeFileName(value: string) {
  return value.replace(/[^a-z0-9а-яё._-]+/gi, "-").replace(/^-+|-+$/g, "") || "route";
}

export function calculateElevationChange(points: Pick<RoutePoint, "ele" | "distance">[]) {
  if (points.length < 2) return { ascent: 0, descent: 0 };

  const simplified = ramerDouglasPeucker(points, 20);
  let ascent = 0;
  let descent = 0;

  for (let i = 0; i < simplified.length - 1; i++) {
    const start = simplified[i]!;
    const end = simplified[i + 1]!;
    let cumulEle = 0;
    let currentStart = start;
    let currentEnd = start;
    let prevSmoothedEle = 0;

    distanceWindowSmoothing(points, start, end + 1, 100, (s, e) => {
      for (let index = currentStart; index < s; index++) cumulEle -= points[index]?.ele ?? 0;
      for (let index = currentEnd; index <= e; index++) cumulEle += points[index]?.ele ?? 0;
      currentStart = s;
      currentEnd = e + 1;
      return cumulEle / (e - s + 1);
    }, (smoothedEle, index) => {
      if (index === start) {
        smoothedEle = points[start]?.ele ?? 0;
        prevSmoothedEle = smoothedEle;
      } else if (index === end) {
        smoothedEle = points[end]?.ele ?? 0;
      }

      const delta = smoothedEle - prevSmoothedEle;
      if (delta > 0) ascent += delta;
      else if (delta < 0) descent -= delta;
      prevSmoothedEle = smoothedEle;
    });
  }

  return { ascent, descent };
}

export const SLOPE_CLASSES = [
  { maxSlope: -8, label: "< -8%", color: "#15803d" },
  { maxSlope: -4, label: "-8..-4%", color: "#22c55e" },
  { maxSlope: -1, label: "-4..-1%", color: "#86efac" },
  { maxSlope: 1, label: "-1..+1%", color: "#d9f99d" },
  { maxSlope: 4, label: "+1..+4%", color: "#fde047" },
  { maxSlope: 7, label: "+4..+7%", color: "#fb923c" },
  { maxSlope: 10, label: "+7..+10%", color: "#ef4444" },
  { maxSlope: Infinity, label: "> +10%", color: "#991b1b" },
] as const;

export function getSlopeColor(slope: number) {
  for (const slopeClass of SLOPE_CLASSES) {
    if (slope < slopeClass.maxSlope) return slopeClass.color;
  }
  return SLOPE_CLASSES.at(-1)!.color;
}

export function calculateProfileSlopes(points: Pick<RoutePoint, "ele" | "distance">[]) {
  return calculateProfileSlopeDetails(points).map(detail => detail.slope);
}

export function calculateProfileSlopeSegments(points: Pick<RoutePoint, "ele" | "distance">[]) {
  if (points.length < 2) return [];

  const simplified = ramerDouglasPeucker(points, 20);
  const segments: { start: number; end: number; slope: number; distance: number }[] = [];

  for (let i = 0; i < simplified.length - 1; i++) {
    const start = simplified[i]!;
    const end = simplified[i + 1]!;
    const distance = points[end]!.distance - points[start]!.distance;
    const elevation = (points[end]!.ele ?? 0) - (points[start]!.ele ?? 0);
    const slope = distance > 0 ? (elevation / distance) * 100 : 0;
    segments.push({ start, end, slope, distance });
  }

  return segments;
}

export function calculateProfileSlopeDetails(points: Pick<RoutePoint, "ele" | "distance">[]) {
  const details = Array.from({ length: points.length }, () => ({ slope: 0, distance: 0 }));

  const segments = calculateProfileSlopeSegments(points);
  for (let i = 0; i < segments.length; i++) {
    const { start, end, slope, distance } = segments[i]!;
    for (let index = start; index < end + (i + 1 === segments.length ? 1 : 0); index++) {
      details[index] = { slope, distance };
    }
  }

  return details;
}

function baseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function calculateElevationChangeBySourceSegment(points: RoutePoint[]) {
  let ascent = 0;
  let descent = 0;
  let start = 0;

  while (start < points.length) {
    let end = start + 1;
    while (end < points.length && points[end]!.sourceSegment === points[start]!.sourceSegment) end++;
    const elevation = calculateElevationChange(points.slice(start, end));
    ascent += elevation.ascent;
    descent += elevation.descent;
    start = end;
  }

  return { ascent, descent };
}

function ramerDouglasPeucker(points: Pick<RoutePoint, "ele" | "distance">[], epsilon: number) {
  if (points.length === 0) return [];
  if (points.length === 1) return [0];

  const simplified = [0];
  ramerDouglasPeuckerRecursive(points, epsilon, 0, points.length - 1, simplified);
  simplified.push(points.length - 1);
  return simplified;
}

function ramerDouglasPeuckerRecursive(
  points: Pick<RoutePoint, "ele" | "distance">[],
  epsilon: number,
  start: number,
  end: number,
  simplified: number[],
) {
  let largestIndex = 0;
  let largestDistance = 0;

  for (let index = start + 1; index < end; index++) {
    const distance = elevationProfileDistance(points[start]!, points[end]!, points[index]!);
    if (distance > largestDistance) {
      largestIndex = index;
      largestDistance = distance;
    }
  }

  if (largestDistance > epsilon && largestIndex !== 0) {
    ramerDouglasPeuckerRecursive(points, epsilon, start, largestIndex, simplified);
    simplified.push(largestIndex);
    ramerDouglasPeuckerRecursive(points, epsilon, largestIndex, end, simplified);
  }
}

function elevationProfileDistance(
  point1: Pick<RoutePoint, "ele" | "distance">,
  point2: Pick<RoutePoint, "ele" | "distance">,
  point3: Pick<RoutePoint, "ele" | "distance">,
) {
  if (point1.ele === null || point2.ele === null || point3.ele === null) return 0;

  const x1 = point1.distance;
  const x2 = point2.distance;
  const x3 = point3.distance;
  const y1 = point1.ele;
  const y2 = point2.ele;
  const y3 = point3.ele;
  const dist = Math.sqrt((y2 - y1) ** 2 + (x2 - x1) ** 2);

  if (dist === 0) return Math.sqrt((x3 - x1) ** 2 + (y3 - y1) ** 2);
  return Math.abs((y2 - y1) * x3 - (x2 - x1) * y3 + x2 * y1 - y2 * x1) / dist;
}

function distanceWindowSmoothing(
  points: Pick<RoutePoint, "distance">[],
  left: number,
  right: number,
  window: number,
  compute: (start: number, end: number) => number,
  callback: (value: number, index: number) => void,
) {
  let start = left;
  for (let index = left; index < right; index++) {
    while (start + 1 < index && points[index]!.distance - points[start]!.distance > window) start++;
    let end = Math.min(index + 2, right);
    while (end < right && points[end]!.distance - points[index]!.distance <= window) end++;
    callback(compute(start, end - 1), index);
  }
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const radius = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
