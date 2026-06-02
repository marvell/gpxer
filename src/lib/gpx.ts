export type RoutePoint = {
  index: number;
  lat: number;
  lon: number;
  ele: number | null;
  time: string | null;
  distance: number;
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

const parser = new DOMParser();
const serializer = new XMLSerializer();

export function parseGpx(text: string, fileName: string): RouteData {
  const document = parser.parseFromString(text, "application/xml");
  const error = document.querySelector("parsererror");
  if (error) throw new Error("GPX file is not valid XML.");

  const trkpts = [...document.querySelectorAll("trkpt")];
  if (trkpts.length < 2) throw new Error("GPX file must contain at least two track points.");

  let distance = 0;
  let ascent = 0;
  let descent = 0;
  const points: RoutePoint[] = [];
  const bounds: [[number, number], [number, number]] = [
    [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  ];

  for (const [index, trkpt] of trkpts.entries()) {
    const lat = Number(trkpt.getAttribute("lat"));
    const lon = Number(trkpt.getAttribute("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const eleText = trkpt.querySelector("ele")?.textContent;
    const ele = eleText === undefined || eleText === null || eleText === "" ? null : Number(eleText);
    const cleanEle = ele !== null && Number.isFinite(ele) ? ele : null;
    const previous = points.at(-1);
    if (previous) {
      distance += haversine(previous.lat, previous.lon, lat, lon);
      if (previous.ele !== null && cleanEle !== null) {
        const delta = cleanEle - previous.ele;
        if (delta > 0) ascent += delta;
        else descent += Math.abs(delta);
      }
    }

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
      trkpt,
    });
  }

  if (points.length < 2) throw new Error("GPX file has no usable track points.");

  return {
    name: document.querySelector("trk > name, metadata > name, name")?.textContent?.trim() || baseName(fileName),
    fileName,
    document,
    points,
    totalDistance: distance,
    ascent,
    descent,
    bounds,
  };
}

export function buildSegments(points: RoutePoint[], splitIndexes: number[]): Segment[] {
  const cuts = [0, ...splitIndexes.filter(index => index > 0 && index < points.length - 1).sort((a, b) => a - b), points.length - 1];

  return cuts.slice(0, -1).map((start, id) => {
    const end = cuts[id + 1]!;
    const slice = points.slice(start, end + 1);
    let ascent = 0;
    let descent = 0;
    let minEle: number | null = null;
    let maxEle: number | null = null;

    for (let index = 0; index < slice.length; index++) {
      const point = slice[index]!;
      if (point.ele !== null) {
        minEle = minEle === null ? point.ele : Math.min(minEle, point.ele);
        maxEle = maxEle === null ? point.ele : Math.max(maxEle, point.ele);
      }
      const previous = slice[index - 1];
      if (previous && previous.ele !== null && point.ele !== null) {
        const delta = point.ele - previous.ele;
        if (delta > 0) ascent += delta;
        else descent += Math.abs(delta);
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
  const doc = document.implementation.createDocument("http://www.topografix.com/GPX/1/1", "gpx");
  const root = doc.documentElement;
  root.setAttribute("version", route.document.documentElement.getAttribute("version") || "1.1");
  root.setAttribute("creator", "gpxsplit");

  const trk = doc.createElement("trk");
  const name = doc.createElement("name");
  name.textContent = `${route.name} - ${segment.name}`;
  const trkseg = doc.createElement("trkseg");

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
  let best = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  const target = distanceKm * 1000;
  for (const point of points) {
    const delta = Math.abs(point.distance - target);
    if (delta < bestDelta) {
      best = point.index;
      bestDelta = delta;
    }
  }
  return best;
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

function baseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
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
