import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  buildSegments,
  downloadText,
  exportSegmentGpx,
  formatDistance,
  formatElevation,
  nearestPoint,
  parseGpx,
  safeFileName,
  type RouteData,
  type Segment,
} from "@/lib/gpx";
import { Download, FileUp, Route, Trash2 } from "lucide-react";
import maplibregl, { type GeoJSONSource, type Map } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import "./index.css";

export function App() {
  const [route, setRoute] = useState<RouteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [splits, setSplits] = useState<number[]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [selectedSegments, setSelectedSegments] = useState<Set<number>>(new Set());
  const [activeSegmentId, setActiveSegmentId] = useState<number | null>(null);
  const previousSegmentIdsRef = useRef<number[]>([]);
  const segments = useMemo(() => (route ? buildSegments(route.points, splits) : []), [route, splits]);
  const activeSegment = segments.find(segment => segment.id === activeSegmentId) ?? null;

  useEffect(() => {
    const previousIds = previousSegmentIdsRef.current;
    const nextIds = segments.map(segment => segment.id);
    const nextIdSet = new Set(nextIds);
    setSelectedSegments(current => {
      const hadAllSelected = previousIds.every(id => current.has(id));
      return hadAllSelected ? new Set(nextIds) : new Set([...current].filter(id => nextIdSet.has(id)));
    });
    previousSegmentIdsRef.current = nextIds;
    setActiveSegmentId(current => (segments.some(segment => segment.id === current) ? current : (segments[0]?.id ?? null)));
  }, [segments.length]);

  async function onUpload(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = parseGpx(await file.text(), file.name);
      setRoute(parsed);
      setSplits([]);
      setHoverIndex(null);
      setActiveSegmentId(1);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not parse GPX file.");
    }
  }

  function toggleSplit(index: number) {
    if (!route || index <= 0 || index >= route.points.length - 1) return;
    setSplits(current => {
      const exists = current.includes(index);
      const next = exists ? current.filter(split => split !== index) : [...current, index].sort((a, b) => a - b);
      const sortedCurrent = [...current].sort((a, b) => a - b);
      const splitPosition = exists ? sortedCurrent.indexOf(index) + 1 : next.indexOf(index) + 1;
      setActiveSegmentId(Math.max(1, splitPosition));
      return next;
    });
  }

  function downloadSegments(targetSegments: Segment[]) {
    if (!route) return;
    targetSegments.forEach(segment => {
      downloadText(`${safeFileName(route.name)}-${String(segment.id).padStart(2, "0")}.gpx`, exportSegmentGpx(route, segment));
    });
  }

  const selected = segments.filter(segment => selectedSegments.has(segment.id));

  return (
    <main className="min-h-screen w-full bg-muted/30 p-3 text-sm md:p-4">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-3">
        <header className="flex flex-col gap-3 rounded-xl border bg-background p-4 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Route className="size-5" />
              <h1 className="text-xl font-semibold">GPX multi-day planner</h1>
            </div>
            <p className="mt-1 text-muted-foreground">Upload GPX, split route by clicks, export unchanged GPX segments.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="gpx-file" className="sr-only">
              GPX file
            </Label>
            <Input
              id="gpx-file"
              type="file"
              accept=".gpx,application/gpx+xml,text/xml,application/xml"
              onChange={event => onUpload(event.currentTarget.files?.[0])}
              className="max-w-sm"
            />
            <Button variant="outline" onClick={() => route && setSplits([])} disabled={!route || splits.length === 0}>
              <Trash2 />
              Clear splits
            </Button>
          </div>
        </header>

        {error && <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive">{error}</div>}

        <section className="grid min-h-[calc(100vh-120px)] grid-cols-1 gap-3 xl:grid-cols-[1fr_420px]">
          <div className="grid min-h-[720px] grid-rows-[minmax(420px,1fr)_260px] gap-3">
            <Card className="overflow-hidden py-0">
              <RouteMap
                route={route}
                splits={splits}
                hoverIndex={hoverIndex}
                activeSegment={activeSegment}
                onHover={setHoverIndex}
                onToggleSplit={toggleSplit}
              />
            </Card>
            <Card className="py-4">
              <CardHeader className="px-4 pb-0">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle>Elevation profile</CardTitle>
                    <CardDescription>Hover to sync with map. Click to split or merge.</CardDescription>
                  </div>
                  <Badge variant="outline">{route ? `${route.points.length.toLocaleString()} points` : "No file"}</Badge>
                </div>
              </CardHeader>
              <CardContent className="px-4">
                <ElevationProfile
                  route={route}
                  splits={splits}
                  hoverIndex={hoverIndex}
                  activeSegment={activeSegment}
                  onHover={setHoverIndex}
                  onToggleSplit={toggleSplit}
                />
              </CardContent>
            </Card>
          </div>

          <aside className="flex min-h-0 flex-col gap-3">
            <Card>
              <CardHeader>
                <CardTitle>Route summary</CardTitle>
                <CardDescription>{route?.name ?? "Upload a GPX file to start."}</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                <Stat label="Distance" value={route ? formatDistance(route.totalDistance) : "—"} />
                <Stat label="Segments" value={route ? String(segments.length) : "—"} />
                <Stat label="Ascent" value={route ? formatElevation(route.ascent) : "—"} />
                <Stat label="Descent" value={route ? formatElevation(route.descent) : "—"} />
              </CardContent>
            </Card>

            <Card className="min-h-0 flex-1">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>Segments</CardTitle>
                    <CardDescription>Split: click track. Merge: click split marker again.</CardDescription>
                  </div>
                  <Badge variant="secondary">{splits.length} cuts</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setSelectedSegments(new Set(segments.map(s => s.id)))} disabled={!segments.length}>
                    Select all
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setSelectedSegments(new Set())} disabled={!segments.length}>
                    Select none
                  </Button>
                  <Button size="sm" onClick={() => downloadSegments(selected)} disabled={!selected.length}>
                    <Download />
                    Selected
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => downloadSegments(segments)} disabled={!segments.length}>
                    <Download />
                    All
                  </Button>
                </div>
                <div className="min-h-0 overflow-auto rounded-lg border">
                  {segments.length ? (
                    segments.map(segment => (
                      <SegmentRow
                        key={segment.id}
                        segment={segment}
                        checked={selectedSegments.has(segment.id)}
                        active={segment.id === activeSegmentId}
                        onSelect={() => setActiveSegmentId(segment.id)}
                        onCheckedChange={checked => {
                          setSelectedSegments(current => {
                            const next = new Set(current);
                            if (checked) next.add(segment.id);
                            else next.delete(segment.id);
                            return next;
                          });
                        }}
                        onHover={setHoverIndex}
                      />
                    ))
                  ) : (
                    <div className="flex h-60 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                      <FileUp className="size-8" />
                      <p>Upload GPX to see segment stats.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </aside>
        </section>
      </div>
    </main>
  );
}

function RouteMap({
  route,
  splits,
  hoverIndex,
  activeSegment,
  onHover,
  onToggleSplit,
}: {
  route: RouteData | null;
  splits: number[];
  hoverIndex: number | null;
  activeSegment: Segment | null;
  onHover: (index: number | null) => void;
  onToggleSplit: (index: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const rafRef = useRef<number | null>(null);
  const splitMarkersRef = useRef<maplibregl.Marker[]>([]);
  const routeRef = useRef<RouteData | null>(null);
  const onHoverRef = useRef(onHover);
  const onToggleSplitRef = useRef(onToggleSplit);

  routeRef.current = route;
  onHoverRef.current = onHover;
  onToggleSplitRef.current = onToggleSplit;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [0, 0],
      zoom: 2,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("route", emptyLine());
      map.addSource("active-segment", emptyLine());
      map.addSource("splits", emptyPoints());
      map.addSource("hover", emptyPoints());
      map.addLayer({ id: "route-line", type: "line", source: "route", paint: { "line-color": "#111827", "line-width": 4 } });
      map.addLayer({ id: "active-segment-line", type: "line", source: "active-segment", paint: { "line-color": "#2563eb", "line-width": 7, "line-opacity": 0.9 } });
      map.addLayer({ id: "route-hit", type: "line", source: "route", paint: { "line-color": "#000", "line-opacity": 0.01, "line-width": 28 } });
      map.addLayer({ id: "hover-point", type: "circle", source: "hover", paint: { "circle-radius": 7, "circle-color": "#2563eb", "circle-stroke-width": 2, "circle-stroke-color": "#fff" } });
      map.addLayer({ id: "split-points", type: "circle", source: "splits", paint: { "circle-radius": 6, "circle-color": "#ef4444", "circle-stroke-width": 2, "circle-stroke-color": "#fff" } });

      const move = (event: maplibregl.MapMouseEvent) => {
        const activeRoute = routeRef.current;
        if (!activeRoute) return;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          onHoverRef.current(nearestLngLat(activeRoute, event.lngLat.lng, event.lngLat.lat));
        });
      };
      const click = (event: maplibregl.MapMouseEvent) => {
        const activeRoute = routeRef.current;
        if (!activeRoute) return;
        const markerIndex = markerIndexAtPoint(map, event.point);
        if (markerIndex !== null) {
          onToggleSplitRef.current(markerIndex);
          return;
        }
        const routeIndex = nearestScreenPoint(map, activeRoute, event.point, 22);
        if (routeIndex !== null) onToggleSplitRef.current(routeIndex);
      };
      const leave = () => onHoverRef.current(null);
      const pointer = () => {
        map.getCanvas().style.cursor = "crosshair";
      };
      const resetPointer = () => {
        map.getCanvas().style.cursor = "";
      };

      map.on("mousemove", "route-hit", move);
      map.on("click", click);
      map.on("mouseenter", "route-hit", pointer);
      map.on("mouseenter", "split-points", pointer);
      map.on("mouseenter", "hover-point", pointer);
      map.on("mouseleave", "route-hit", leave);
      map.on("mouseleave", "route-hit", resetPointer);
      map.on("mouseleave", "split-points", resetPointer);
      map.on("mouseleave", "hover-point", resetPointer);
    });
    mapRef.current = map;
    return () => {
      splitMarkersRef.current.forEach(marker => marker.remove());
      splitMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route) return;
    const update = () => {
      (map.getSource("route") as GeoJSONSource | undefined)?.setData(lineData(route));
      map.fitBounds(route.bounds, { padding: 48, duration: 0 });
    };
    map.getSource("route") ? update() : map.once("load", update);
  }, [route]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route) return;
    const update = () => {
      (map.getSource("active-segment") as GeoJSONSource | undefined)?.setData(activeSegment ? segmentLineData(route, activeSegment) : emptyLine().data);
      if (activeSegment) {
        map.fitBounds(segmentBounds(route, activeSegment), { padding: 72, duration: 350, maxZoom: 15 });
      }
    };
    map.getSource("active-segment") ? update() : map.once("load", update);
  }, [route, activeSegment]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route) return;
    const update = () => {
      (map.getSource("splits") as GeoJSONSource | undefined)?.setData(pointData(route, splits));
      splitMarkersRef.current.forEach(marker => marker.remove());
      splitMarkersRef.current = splits.map(index => {
        const point = route.points[index]!;
        const markerElement = document.createElement("button");
        markerElement.type = "button";
        markerElement.title = "Remove split";
        markerElement.className =
          "size-4 rounded-full border-2 border-white bg-red-500 shadow-md ring-2 ring-red-500/25";
        markerElement.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          onToggleSplitRef.current(index);
        });
        return new maplibregl.Marker({ element: markerElement, anchor: "center" })
          .setLngLat([point.lon, point.lat])
          .addTo(map);
      });
    };
    map.getSource("splits") ? update() : map.once("load", update);
  }, [route, splits]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route) return;
    const update = () => (map.getSource("hover") as GeoJSONSource | undefined)?.setData(pointData(route, hoverIndex === null ? [] : [hoverIndex]));
    map.getSource("hover") ? update() : map.once("load", update);
  }, [route, hoverIndex]);

  return (
    <div className="relative h-full min-h-[420px]">
      <div ref={containerRef} className="h-full w-full" />
      {!route && <div className="absolute inset-0 grid place-items-center bg-background/80 text-muted-foreground">Upload GPX to show map.</div>}
    </div>
  );
}

function ElevationProfile({
  route,
  splits,
  hoverIndex,
  activeSegment,
  onHover,
  onToggleSplit,
}: {
  route: RouteData | null;
  splits: number[];
  hoverIndex: number | null;
  activeSegment: Segment | null;
  onHover: (index: number | null) => void;
  onToggleSplit: (index: number) => void;
}) {
  const width = 1200;
  const height = 170;
  const pad = 20;
  const points = route?.points ?? [];
  const elevations = points.map(point => point.ele).filter(ele => ele !== null);
  const minEle = elevations.length ? Math.min(...elevations) : 0;
  const maxEle = elevations.length ? Math.max(...elevations) : 1;
  const total = route?.totalDistance || 1;
  const yRange = Math.max(1, maxEle - minEle);
  const x = (distance: number) => pad + (distance / total) * (width - pad * 2);
  const y = (ele: number | null) => height - pad - (((ele ?? minEle) - minEle) / yRange) * (height - pad * 2);
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.distance).toFixed(2)},${y(point.ele).toFixed(2)}`).join(" ");

  function indexFromEvent(event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) {
    if (!route) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    return nearestPoint(route.points, (ratio * route.totalDistance) / 1000);
  }

  if (!route) return <div className="grid h-[180px] place-items-center text-muted-foreground">Elevation profile will appear after upload.</div>;

  const hover = hoverIndex === null ? null : points[hoverIndex];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-[180px] w-full touch-none"
      onPointerMove={event => onHover(indexFromEvent(event))}
      onPointerLeave={() => onHover(null)}
      onClick={event => {
        const index = indexFromEvent(event);
        if (index !== null) onToggleSplit(index);
      }}
    >
      <rect x="0" y="0" width={width} height={height} rx="12" className="fill-muted/50" />
      {activeSegment && (
        <rect
          x={x(points[activeSegment.start]!.distance)}
          y={pad}
          width={Math.max(2, x(points[activeSegment.end]!.distance) - x(points[activeSegment.start]!.distance))}
          height={height - pad * 2}
          rx="6"
          className="fill-blue-500/15"
        />
      )}
      <path d={`${path} L${width - pad},${height - pad} L${pad},${height - pad} Z`} className="fill-primary/10" />
      <path d={path} className="fill-none stroke-primary" strokeWidth="3" />
      {activeSegment && (
        <path
          d={points
            .slice(activeSegment.start, activeSegment.end + 1)
            .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.distance).toFixed(2)},${y(point.ele).toFixed(2)}`)
            .join(" ")}
          className="fill-none stroke-blue-600"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {splits.map(index => (
        <line key={index} x1={x(points[index]!.distance)} x2={x(points[index]!.distance)} y1={pad} y2={height - pad} className="stroke-destructive" strokeDasharray="5 5" strokeWidth="2" />
      ))}
      {hover && (
        <>
          <line x1={x(hover.distance)} x2={x(hover.distance)} y1={pad} y2={height - pad} className="stroke-blue-600" strokeWidth="2" />
          <circle cx={x(hover.distance)} cy={y(hover.ele)} r="6" className="fill-blue-600 stroke-background" strokeWidth="3" />
        </>
      )}
    </svg>
  );
}

function SegmentRow({
  segment,
  checked,
  active,
  onSelect,
  onCheckedChange,
  onHover,
}: {
  segment: Segment;
  checked: boolean;
  active: boolean;
  onSelect: () => void;
  onCheckedChange: (checked: boolean) => void;
  onHover: (index: number | null) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`grid w-full grid-cols-[auto_1fr] gap-3 border-b p-3 text-left transition-colors last:border-b-0 hover:bg-muted/60 ${active ? "bg-blue-50 ring-1 ring-inset ring-blue-200 dark:bg-blue-950/30 dark:ring-blue-900" : ""}`}
      onClick={onSelect}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") onSelect();
      }}
      onMouseEnter={() => onHover(segment.start)}
      onMouseLeave={() => onHover(null)}
    >
      <Checkbox
        checked={checked}
        onClick={event => event.stopPropagation()}
        onCheckedChange={value => onCheckedChange(value === true)}
      />
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="font-medium">{segment.name}</div>
          <Badge variant="outline">{formatDistance(segment.distance)}</Badge>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>Points: {segment.start + 1}–{segment.end + 1}</span>
          <span>Points: {segment.points}</span>
          <span>Ascent: {formatElevation(segment.ascent)}</span>
          <span>Descent: {formatElevation(segment.descent)}</span>
          <span>Min: {formatElevation(segment.minEle)}</span>
          <span>Max: {formatElevation(segment.maxEle)}</span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

function emptyLine(): maplibregl.GeoJSONSourceSpecification {
  return { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } } };
}

function emptyPoints(): maplibregl.GeoJSONSourceSpecification {
  return { type: "geojson", data: { type: "FeatureCollection", features: [] } };
}

function lineData(route: RouteData): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: route.points.map(point => [point.lon, point.lat]) },
  };
}

function segmentLineData(route: RouteData, segment: Segment): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    properties: { id: segment.id },
    geometry: {
      type: "LineString",
      coordinates: route.points.slice(segment.start, segment.end + 1).map(point => [point.lon, point.lat]),
    },
  };
}

function segmentBounds(route: RouteData, segment: Segment): [[number, number], [number, number]] {
  const bounds: [[number, number], [number, number]] = [
    [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  ];

  for (const point of route.points.slice(segment.start, segment.end + 1)) {
    bounds[0][0] = Math.min(bounds[0][0], point.lon);
    bounds[0][1] = Math.min(bounds[0][1], point.lat);
    bounds[1][0] = Math.max(bounds[1][0], point.lon);
    bounds[1][1] = Math.max(bounds[1][1], point.lat);
  }

  return bounds;
}

function pointData(route: RouteData, indexes: number[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: indexes.map(index => ({
      type: "Feature",
      properties: { index },
      geometry: { type: "Point", coordinates: [route.points[index]!.lon, route.points[index]!.lat] },
    })),
  };
}

function nearestLngLat(route: RouteData, lon: number, lat: number) {
  let best = 0;
  let bestValue = Number.POSITIVE_INFINITY;
  for (const point of route.points) {
    const value = (point.lon - lon) ** 2 + (point.lat - lat) ** 2;
    if (value < bestValue) {
      best = point.index;
      bestValue = value;
    }
  }
  return best;
}

function markerIndexAtPoint(map: Map, point: maplibregl.PointLike) {
  const [x, y] = Array.isArray(point) ? point : [point.x, point.y];
  const features = map.queryRenderedFeatures(
    [
      [x - 10, y - 10],
      [x + 10, y + 10],
    ],
    { layers: ["split-points", "hover-point"] },
  );
  const index = Number(features[0]?.properties?.index);
  return Number.isInteger(index) ? index : null;
}

function nearestScreenPoint(map: Map, route: RouteData, clickPoint: maplibregl.PointLike, maxPixels: number) {
  const [clickX, clickY] = Array.isArray(clickPoint) ? clickPoint : [clickPoint.x, clickPoint.y];
  let bestIndex: number | null = null;
  let bestDistance = maxPixels ** 2;

  for (const point of route.points) {
    const screenPoint = map.project([point.lon, point.lat]);
    const distance = (screenPoint.x - clickX) ** 2 + (screenPoint.y - clickY) ** 2;
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestIndex = point.index;
    }
  }

  return bestIndex;
}

export default App;
