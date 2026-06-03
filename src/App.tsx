import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  buildSegments,
  calculateProfileSlopeSegments,
  downloadText,
  exportSegmentGpx,
  formatDistance,
  formatElevation,
  getSlopeColor,
  nearestPoint,
  parseGpx,
  safeFileName,
  SLOPE_CLASSES,
  type RouteData,
  type Segment,
} from "@/lib/gpx";
import { Download, Route, Trash2, Upload } from "lucide-react";
import maplibregl, { type GeoJSONSource, type Map } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./index.css";

export function App() {
  const [route, setRoute] = useState<RouteData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [splits, setSplits] = useState<number[]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [selectedSegments, setSelectedSegments] = useState<Set<number>>(new Set());
  const [activeSegmentId, setActiveSegmentId] = useState<number | null>(null);
  const [mapDistanceRange, setMapDistanceRange] = useState<DistanceRange | null>(null);
  const previousSegmentIdsRef = useRef<number[]>([]);
  const hoverIndexRef = useRef<number | null>(null);
  const mapDistanceRangeRef = useRef<DistanceRange | null>(null);
  const segments = useMemo(() => (route ? buildSegments(route.points, splits) : []), [route, splits]);
  const activeSegment = segments.find(segment => segment.id === activeSegmentId) ?? null;
  const setHoverIndexIfChanged = useCallback((index: number | null) => {
    if (hoverIndexRef.current === index) return;
    hoverIndexRef.current = index;
    setHoverIndex(index);
  }, []);
  const setMapDistanceRangeIfChanged = useCallback((range: DistanceRange | null) => {
    const current = mapDistanceRangeRef.current;
    const changed = current?.start !== range?.start || current?.end !== range?.end;
    if (!changed) return;
    mapDistanceRangeRef.current = range;
    setMapDistanceRange(range);
  }, []);

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
      setHoverIndexIfChanged(null);
      setMapDistanceRangeIfChanged(null);
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

  const allSelected = segments.length > 0 && selected.length === segments.length;

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-muted/40 text-sm">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-background px-4">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center bg-primary text-primary-foreground">
            <Route className="size-4" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">GPX Splitter</div>
            <div className="max-w-[200px] truncate text-[11px] text-muted-foreground">{route?.name ?? "No file loaded"}</div>
          </div>
        </div>

        {route && (
          <div className="ml-2 hidden items-stretch border lg:flex">
            <StatPill label="Dist" value={formatDistance(route.totalDistance)} />
            <StatPill label="Asc" value={formatElevation(route.ascent)} />
            <StatPill label="Desc" value={formatElevation(route.descent)} />
            <StatPill label="Seg" value={String(segments.length)} />
            <StatPill label="Cuts" value={String(splits.length)} last />
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="rounded-none" onClick={() => route && setSplits([])} disabled={!route || splits.length === 0}>
            <Trash2 />
            Clear splits
          </Button>
          <UploadButton onFile={onUpload} variant={route ? "outline" : "default"} />
        </div>
      </header>

      {error && (
        <div className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-4 py-2 font-medium text-destructive">{error}</div>
      )}

      {!route ? (
        <Dropzone onFile={onUpload} />
      ) : (
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-px bg-border xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_minmax(132px,22vh)] gap-px bg-border">
            <div className="relative min-h-[260px] bg-background">
              <RouteMap
                route={route}
                splits={splits}
                hoverIndex={hoverIndex}
                activeSegment={activeSegment}
                onHover={setHoverIndexIfChanged}
                onToggleSplit={toggleSplit}
                onVisibleRange={setMapDistanceRangeIfChanged}
              />
              <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-1.5 text-[11px]">
                <span className="bg-background/90 px-2 py-1 font-medium shadow-sm backdrop-blur">Click track to split</span>
                <span className="bg-background/90 px-2 py-1 font-medium shadow-sm backdrop-blur">Click marker to merge</span>
              </div>
            </div>
            <div className="flex min-h-[160px] min-w-0 flex-col bg-background">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
                <div className="text-xs font-semibold uppercase tracking-wide">Elevation profile</div>
                <Badge variant="outline" className="rounded-none font-mono tabular-nums">{route.points.length.toLocaleString()} pts</Badge>
              </div>
              <div className="min-h-0 min-w-0 flex-1 p-3">
                <ElevationProfile
                  route={route}
                  splits={splits}
                  hoverIndex={hoverIndex}
                  activeSegment={activeSegment}
                  focusRange={mapDistanceRange}
                  onHover={setHoverIndexIfChanged}
                  onToggleSplit={toggleSplit}
                />
              </div>
            </div>
          </div>

          <aside className="flex min-h-0 flex-col bg-background">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
              <div className="text-xs font-semibold uppercase tracking-wide">Segments</div>
              <Badge variant="secondary" className="rounded-none font-mono tabular-nums">{segments.length} total</Badge>
            </div>

            <div className="flex flex-col gap-2 border-b px-4 py-3">
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" className="rounded-none" onClick={() => setSelectedSegments(allSelected ? new Set() : new Set(segments.map(s => s.id)))} disabled={!segments.length}>
                  {allSelected ? "Deselect all" : "Select all"}
                </Button>
                <Button size="sm" variant="outline" className="rounded-none" onClick={() => downloadSegments(segments)} disabled={!segments.length}>
                  <Download />
                  Export all
                </Button>
              </div>
              <Button size="sm" className="w-full rounded-none" onClick={() => downloadSegments(selected)} disabled={!selected.length}>
                <Download />
                Export selected ({selected.length})
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              {segments.map(segment => (
                <SegmentRow
                  key={segment.id}
                  segment={segment}
                  checked={selectedSegments.has(segment.id)}
                  active={segment.id === activeSegmentId}
                  onSelect={() => setActiveSegmentId(segment.id)}
                  onExport={() => downloadSegments([segment])}
                  onCheckedChange={checked => {
                    setSelectedSegments(current => {
                      const next = new Set(current);
                      if (checked) next.add(segment.id);
                      else next.delete(segment.id);
                      return next;
                    });
                  }}
                  onHover={setHoverIndexIfChanged}
                />
              ))}
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

const GPX_ACCEPT = ".gpx,application/gpx+xml,text/xml,application/xml";
type DistanceRange = { start: number; end: number };
type ProfilePoint = Pick<RouteData["points"][number], "distance" | "ele">;
type ProfileSlopeSegment = ReturnType<typeof calculateProfileSlopeSegments>[number];

function UploadButton({ onFile, variant }: { onFile: (file: File | undefined) => void; variant: "default" | "outline" }) {
  return (
    <Button asChild size="sm" variant={variant} className="rounded-none">
      <label className="cursor-pointer">
        <Upload />
        Upload GPX
        <input type="file" accept={GPX_ACCEPT} className="sr-only" onChange={event => onFile(event.currentTarget.files?.[0])} />
      </label>
    </Button>
  );
}

function StatPill({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex flex-col justify-center px-3 py-1 ${last ? "" : "border-r"}`}>
      <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono text-xs font-semibold tabular-nums leading-tight">{value}</span>
    </div>
  );
}

function Dropzone({ onFile }: { onFile: (file: File | undefined) => void }) {
  const [drag, setDrag] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <label
        onDragOver={event => {
          event.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={event => {
          event.preventDefault();
          setDrag(false);
          onFile(event.dataTransfer.files?.[0]);
        }}
        className={`flex w-full max-w-xl cursor-pointer flex-col items-center gap-5 border-2 border-dashed p-12 text-center transition-colors ${drag ? "border-primary bg-muted" : "border-border bg-background hover:bg-muted/50"}`}
      >
        <div className="grid size-14 place-items-center border bg-muted">
          <Upload className="size-6 text-muted-foreground" />
        </div>
        <div>
          <div className="text-base font-semibold">Drop a GPX file here</div>
          <div className="mt-1 text-sm text-muted-foreground">or click to browse — split a route into multi-day segments</div>
        </div>
        <div className="flex flex-wrap justify-center gap-2 text-[11px] text-muted-foreground">
          <span className="border px-2 py-1">Click track to split</span>
          <span className="border px-2 py-1">Click marker to merge</span>
          <span className="border px-2 py-1">Export unchanged GPX</span>
        </div>
        <input type="file" accept={GPX_ACCEPT} className="sr-only" onChange={event => onFile(event.currentTarget.files?.[0])} />
      </label>
    </div>
  );
}

function RouteMap({
  route,
  splits,
  hoverIndex,
  activeSegment,
  onHover,
  onToggleSplit,
  onVisibleRange,
}: {
  route: RouteData | null;
  splits: number[];
  hoverIndex: number | null;
  activeSegment: Segment | null;
  onHover: (index: number | null) => void;
  onToggleSplit: (index: number) => void;
  onVisibleRange: (range: DistanceRange | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const rafRef = useRef<number | null>(null);
  const routeRef = useRef<RouteData | null>(null);
  const onHoverRef = useRef(onHover);
  const onToggleSplitRef = useRef(onToggleSplit);
  const onVisibleRangeRef = useRef(onVisibleRange);
  const routeLineData = useMemo(() => (route ? lineData(route) : null), [route]);
  const activeSegmentLineData = useMemo(
    () => (route && activeSegment ? segmentLineData(route, activeSegment) : emptyLine().data),
    [route, activeSegment],
  );
  const splitPointData = useMemo(() => (route ? pointData(route, splits) : emptyPoints().data), [route, splits]);
  const hoverPointData = useMemo(
    () => (route ? pointData(route, hoverIndex === null ? [] : [hoverIndex]) : emptyPoints().data),
    [route, hoverIndex],
  );

  routeRef.current = route;
  onHoverRef.current = onHover;
  onToggleSplitRef.current = onToggleSplit;
  onVisibleRangeRef.current = onVisibleRange;

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
      map.addLayer({ id: "route-line", type: "line", source: "route", paint: { "line-color": "#0072bb", "line-width": 4 } });
      map.addLayer({ id: "active-segment-line", type: "line", source: "active-segment", paint: { "line-color": "#1e91d6", "line-width": 7, "line-opacity": 0.9 } });
      map.addLayer({ id: "route-hit", type: "line", source: "route", paint: { "line-color": "#000", "line-opacity": 0.01, "line-width": 28 } });
      map.addLayer({ id: "hover-point", type: "circle", source: "hover", paint: { "circle-radius": 7, "circle-color": "#1e91d6", "circle-stroke-width": 2, "circle-stroke-color": "#fff" } });
      map.addLayer({ id: "split-points", type: "circle", source: "splits", paint: { "circle-radius": 6, "circle-color": "#e18335", "circle-stroke-width": 2, "circle-stroke-color": "#fff" } });

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
      const reportVisibleRange = () => {
        const activeRoute = routeRef.current;
        onVisibleRangeRef.current(activeRoute ? visibleDistanceRange(map, activeRoute) : null);
      };

      map.on("mousemove", "route-hit", move);
      map.on("click", click);
      map.on("moveend", reportVisibleRange);
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
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route || !routeLineData) return;
    const update = () => {
      (map.getSource("route") as GeoJSONSource | undefined)?.setData(routeLineData);
      map.fitBounds(route.bounds, { padding: 48, duration: 0 });
      requestAnimationFrame(() => onVisibleRange(route ? visibleDistanceRange(map, route) : null));
    };
    map.getSource("route") ? update() : map.once("load", update);
  }, [onVisibleRange, route, routeLineData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route) return;
    const update = () => {
      (map.getSource("active-segment") as GeoJSONSource | undefined)?.setData(activeSegmentLineData);
      if (activeSegment) {
        map.fitBounds(segmentBounds(route, activeSegment), { padding: 72, duration: 350, maxZoom: 15 });
      }
    };
    map.getSource("active-segment") ? update() : map.once("load", update);
  }, [route, activeSegment, activeSegmentLineData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route) return;
    const update = () => {
      (map.getSource("splits") as GeoJSONSource | undefined)?.setData(splitPointData);
    };
    map.getSource("splits") ? update() : map.once("load", update);
  }, [route, splitPointData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route) return;
    const update = () => (map.getSource("hover") as GeoJSONSource | undefined)?.setData(hoverPointData);
    map.getSource("hover") ? update() : map.once("load", update);
  }, [route, hoverPointData]);

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
  focusRange,
  onHover,
  onToggleSplit,
}: {
  route: RouteData | null;
  splits: number[];
  hoverIndex: number | null;
  activeSegment: Segment | null;
  focusRange: DistanceRange | null;
  onHover: (index: number | null) => void;
  onToggleSplit: (index: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 180 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      const next = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
      setSize(current => current.width === next.width && current.height === next.height ? current : next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const { width, height } = size;
  const padLeft = 54;
  const padRight = 18;
  const padTop = 12;
  const padBottom = 26;
  const points = route?.points ?? [];
  const total = route?.totalDistance || 1;
  const profileRange = useMemo(() => normalizeProfileRange(focusRange, total), [focusRange, total]);
  const visiblePoints = useMemo(() => clipProfilePoints(points, profileRange), [points, profileRange]);
  const plotRight = width - padRight;
  const plotBottom = height - padBottom;
  const plotWidth = Math.max(1, plotRight - padLeft);
  const plotHeight = Math.max(1, height - padTop - padBottom);
  const profileSlopeSegments = useMemo(() => calculateProfileSlopeSegments(visiblePoints), [visiblePoints]);

  const profile = useMemo(() => {
    const elevations = visiblePoints.map(point => point.ele).filter(ele => ele !== null);
    const minEle = elevations.length ? Math.min(...elevations) : 0;
    const maxEle = elevations.length ? Math.max(...elevations) : 1;
    const yRange = Math.max(1, maxEle - minEle);
    const rangeDistance = Math.max(1, profileRange.end - profileRange.start);
    const xFor = (distance: number) => padLeft + ((distance - profileRange.start) / rangeDistance) * plotWidth;
    const yFor = (ele: number | null) => padTop + (1 - ((ele ?? minEle) - minEle) / yRange) * plotHeight;
    const path = visiblePoints.map((point, index) => `${index === 0 ? "M" : "L"}${xFor(point.distance).toFixed(2)},${yFor(point.ele).toFixed(2)}`).join(" ");
    const activeRange = activeSegment && points.length
      ? intersectionRange(profileRange, {
        start: points[activeSegment.start]?.distance ?? 0,
        end: points[activeSegment.end]?.distance ?? 0,
      })
      : null;
    const activePoints = activeRange ? clipProfilePoints(points, activeRange) : [];
    const activePath = activePoints.map((point, index) => `${index === 0 ? "M" : "L"}${xFor(point.distance).toFixed(2)},${yFor(point.ele).toFixed(2)}`).join(" ");

    return {
      activeRange,
      activePath,
      areaPath: `${path} L${plotRight},${plotBottom} L${padLeft},${plotBottom} Z`,
      maxEle,
      minEle,
      path,
      slopeStops: buildSlopeStops(visiblePoints, profileSlopeSegments, distance => ((xFor(distance) - padLeft) / plotWidth) * 100),
      x: xFor,
      y: yFor,
      yTicks: [0, 0.25, 0.5, 0.75, 1].map(value => minEle + yRange * value),
    };
  }, [activeSegment, padLeft, points, plotBottom, plotHeight, plotRight, plotWidth, profileRange, profileSlopeSegments, visiblePoints]);
  const { activeRange, activePath, areaPath, path, slopeStops, x, y, yTicks } = profile;
  const hoverPoint = hoverIndex === null ? null : points[hoverIndex];
  const hover = hoverPoint && hoverPoint.distance >= profileRange.start && hoverPoint.distance <= profileRange.end ? hoverPoint : null;
  const hoverSlope = hover ? slopeDetailAtDistance(visiblePoints, profileSlopeSegments, hover.distance) : null;
  const hoverSlopeColor = getSlopeColor(hoverSlope?.slope ?? 0);
  const hoverX = hover ? x(hover.distance) : 0;
  const hoverY = hover ? y(hover.ele) : 0;
  const hoverLabelWidth = 138;
  const hoverLabelHeight = 58;
  const hoverLabelX = Math.min(width - hoverLabelWidth - 8, Math.max(padLeft + 8, hoverX + 10));
  const hoverLabelY = hoverY < 70 ? hoverY + 14 : hoverY - 62;
  const slopeLegendWidth = Math.min(320, Math.max(200, plotWidth - 24));
  const slopeLegendHeight = 8;
  const slopeLegendSegment = slopeLegendWidth / SLOPE_CLASSES.length;
  const slopeLegendBounds = [-8, -4, -1, 1, 4, 7, 10];
  const slopeLegendX = Math.max(padLeft + 8, plotRight - slopeLegendWidth - 12);
  const slopeLegendY = padTop + 10;

  function indexFromEvent(event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) {
    if (!route) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * width;
    const plotX = Math.max(padLeft, Math.min(plotRight, svgX));
    const ratio = (plotX - padLeft) / plotWidth;
    const distance = profileRange.start + ratio * (profileRange.end - profileRange.start);
    return nearestPoint(route.points, distance / 1000);
  }

  return (
    <div ref={containerRef} className="h-full w-full min-w-0 overflow-hidden">
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="block h-full w-full touch-none cursor-crosshair"
      onPointerMove={event => onHover(indexFromEvent(event))}
      onPointerLeave={() => onHover(null)}
      onClick={event => {
        const index = indexFromEvent(event);
        if (index !== null) onToggleSplit(index);
      }}
    >
      <defs>
        <linearGradient id="elevation-fill" x1="0" x2="1" y1="0" y2="0">
          {slopeStops.length > 0 ? (
            slopeStops.map((stop, index) => (
              <stop key={`${stop.offset}-${index}`} offset={`${stop.offset}%`} stopColor={stop.color} stopOpacity="0.9" />
            ))
          ) : (
            <>
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.02" />
            </>
          )}
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={width} height={height} rx="0" className="fill-muted/40" />
      <rect x={padLeft} y={padTop} width={plotWidth} height={plotHeight} className="fill-background/70" />
      {yTicks.map(tick => (
        <g key={tick.toFixed(2)}>
          <line x1={padLeft} x2={plotRight} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <text x={padLeft - 8} y={y(tick)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground font-mono text-[10px]">
            {formatElevation(tick)}
          </text>
        </g>
      ))}
      <line x1={padLeft} x2={padLeft} y1={padTop} y2={plotBottom} className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <line x1={padLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {activeRange && (
        <rect
          x={x(activeRange.start)}
          y={padTop}
          width={Math.max(2, x(activeRange.end) - x(activeRange.start))}
          height={plotHeight}
          rx="0"
          className="fill-primary/10"
        />
      )}
      <path d={areaPath} fill="url(#elevation-fill)" />
      <path d={path} className="fill-none stroke-foreground" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {activeSegment && (
        <path
          d={activePath}
          className="fill-none stroke-primary"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {splits.filter(index => points[index]!.distance >= profileRange.start && points[index]!.distance <= profileRange.end).map(index => (
        <g key={index}>
          <line x1={x(points[index]!.distance)} x2={x(points[index]!.distance)} y1={padTop} y2={plotBottom} className="stroke-destructive" strokeDasharray="4 4" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          <circle cx={x(points[index]!.distance)} cy={plotBottom} r="3.5" className="fill-destructive stroke-background" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </g>
      ))}
      {slopeStops.length > 0 && (
        <g>
          <rect x={slopeLegendX - 8} y={slopeLegendY - 10} width={slopeLegendWidth + 16} height="38" className="fill-background/90 stroke-border" vectorEffect="non-scaling-stroke" />
          <text x={slopeLegendX} y={slopeLegendY - 1} className="fill-muted-foreground font-mono text-[10px]">
            Slope
          </text>
          {SLOPE_CLASSES.map((slopeClass, index) => (
            <rect
              key={slopeClass.label}
              x={slopeLegendX + index * slopeLegendSegment}
              y={slopeLegendY + 4}
              width={slopeLegendSegment}
              height={slopeLegendHeight}
              fill={slopeClass.color}
              className="stroke-border"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {slopeLegendBounds.map((bound, index) => (
            <text
              key={bound}
              x={slopeLegendX + (index + 1) * slopeLegendSegment}
              y={slopeLegendY + 25}
              textAnchor="middle"
              className="fill-muted-foreground font-mono text-[9px]"
            >
              {bound > 0 ? `+${bound}` : bound}
            </text>
          ))}
        </g>
      )}
      {hover && (
        <>
          <line x1={hoverX} x2={hoverX} y1={padTop} y2={plotBottom} className="stroke-primary" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          <circle cx={hoverX} cy={hoverY} r="5" className="fill-primary stroke-background" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          <g>
            <rect x={hoverLabelX} y={hoverLabelY} width={hoverLabelWidth} height={hoverLabelHeight} className="fill-background stroke-border" vectorEffect="non-scaling-stroke" />
            <text x={hoverLabelX + 8} y={hoverLabelY + 11} className="fill-muted-foreground font-mono text-[10px]">
              Distance: {formatDistance(hover.distance)}
            </text>
            <text x={hoverLabelX + 8} y={hoverLabelY + 25} className="fill-foreground font-mono text-[11px] font-semibold">
              Elevation: {formatElevation(hover.ele)}
            </text>
            <text x={hoverLabelX + 8} y={hoverLabelY + 39} className="fill-muted-foreground font-mono text-[10px]">
              Slope dist: {formatDistance(hoverSlope?.distance ?? 0)}
            </text>
            <rect x={hoverLabelX + 8} y={hoverLabelY + 44} width="8" height="8" fill={hoverSlopeColor} stroke="currentColor" className="text-border" vectorEffect="non-scaling-stroke" />
            <text x={hoverLabelX + 8} y={hoverLabelY + 53} className="fill-foreground font-mono text-[11px] font-semibold">
              <tspan dx="14">Avg slope: {formatSlope(hoverSlope?.slope ?? 0)}</tspan>
            </text>
          </g>
        </>
      )}
      <text x={padLeft} y={height - 7} textAnchor="start" className="fill-muted-foreground font-mono text-[10px]">{formatDistance(profileRange.start)}</text>
      <text x={padLeft + plotWidth / 2} y={height - 7} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">{formatDistance((profileRange.start + profileRange.end) / 2)}</text>
      <text x={plotRight} y={height - 7} textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">{formatDistance(profileRange.end)}</text>
    </svg>
    </div>
  );
}

function normalizeProfileRange(range: DistanceRange | null, total: number): DistanceRange {
  if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) {
    return { start: 0, end: total };
  }

  const start = Math.max(0, Math.min(total, range.start));
  const end = Math.max(0, Math.min(total, range.end));
  return end > start ? { start, end } : { start: 0, end: total };
}

function intersectionRange(first: DistanceRange, second: DistanceRange): DistanceRange | null {
  const start = Math.max(first.start, second.start);
  const end = Math.min(first.end, second.end);
  return end > start ? { start, end } : null;
}

function clipProfilePoints(points: RouteData["points"], range: DistanceRange): ProfilePoint[] {
  if (points.length === 0) return [];

  const start = Math.max(points[0]!.distance, range.start);
  const end = Math.min(points.at(-1)!.distance, range.end);
  if (end < start) return [];

  const clipped: ProfilePoint[] = [interpolateProfilePoint(points, start)];
  const startIndex = lowerBoundDistance(points, start);
  const endIndex = lowerBoundDistance(points, end);

  for (let index = startIndex; index < endIndex; index++) {
    const point = points[index]!;
    if (point.distance > start) clipped.push({ distance: point.distance, ele: point.ele });
  }

  if (end > start) clipped.push(interpolateProfilePoint(points, end));
  return clipped;
}

function interpolateProfilePoint(points: RouteData["points"], distance: number): ProfilePoint {
  if (distance <= points[0]!.distance) return { distance, ele: points[0]!.ele };
  if (distance >= points.at(-1)!.distance) return { distance, ele: points.at(-1)!.ele };

  const index = lowerBoundDistance(points, distance);
  const after = points[index]!;
  const before = points[index - 1]!;
  if (after.distance === distance) return { distance, ele: after.ele };

  const ratio = (distance - before.distance) / Math.max(1, after.distance - before.distance);
  const ele = before.ele === null && after.ele === null
    ? null
    : before.ele === null
      ? after.ele
      : after.ele === null
        ? before.ele
        : before.ele + (after.ele - before.ele) * ratio;

  return { distance, ele };
}

function lowerBoundDistance(points: ProfilePoint[], distance: number) {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid]!.distance < distance) low = mid + 1;
    else high = mid;
  }
  return low;
}

function slopeDetailAtDistance(points: ProfilePoint[], segments: ProfileSlopeSegment[], distance: number) {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const index = Math.floor((low + high) / 2);
    const segment = segments[index]!;
    const start = points[segment.start]?.distance ?? 0;
    const end = points[segment.end]?.distance ?? start;
    if (distance >= start && distance <= end) return { slope: segment.slope, distance: segment.distance };
    if (distance < start) high = index - 1;
    else low = index + 1;
  }

  return null;
}

function buildSlopeStops(
  points: ProfilePoint[],
  segments: ProfileSlopeSegment[],
  offsetForDistance: (distance: number) => number,
) {
  if (points.length < 2) return [];

  const total = points.at(-1)?.distance ?? 0;
  if (total <= 0) return [];

  const stops: { offset: number; color: string }[] = [];

  for (const segment of segments) {
    const start = points[segment.start]!;
    const end = points[segment.end]!;
    if (end.distance <= start.distance) continue;

    const color = getSlopeColor(segment.slope);
    const startOffset = offsetForDistance(start.distance);
    const endOffset = offsetForDistance(end.distance);

    stops.push({ offset: startOffset, color });
    stops.push({ offset: endOffset, color });
  }

  return stops;
}

function formatSlope(slope: number) {
  return `${slope.toFixed(1)}%`;
}

function SegmentRow({
  segment,
  checked,
  active,
  onSelect,
  onExport,
  onCheckedChange,
  onHover,
}: {
  segment: Segment;
  checked: boolean;
  active: boolean;
  onSelect: () => void;
  onExport: () => void;
  onCheckedChange: (checked: boolean) => void;
  onHover: (index: number | null) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`grid w-full grid-cols-[auto_1fr_auto] items-start gap-3 border-b border-l-2 p-3 text-left transition-colors last:border-b-0 hover:bg-muted/60 ${active ? "border-l-primary bg-muted" : "border-l-transparent"}`}
      onClick={onSelect}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") onSelect();
      }}
      onMouseEnter={() => onHover(segment.start)}
      onMouseLeave={() => onHover(null)}
    >
      <Checkbox
        className="mt-0.5 rounded-none"
        checked={checked}
        onClick={event => event.stopPropagation()}
        onCheckedChange={value => onCheckedChange(value === true)}
      />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={`grid size-5 shrink-0 place-items-center font-mono text-[10px] font-semibold ${active ? "bg-primary text-primary-foreground" : "bg-muted-foreground/15 text-foreground"}`}>
            {segment.id}
          </span>
          <span className="truncate text-xs font-semibold uppercase tracking-wide">{segment.name}</span>
          <Badge variant="outline" className="ml-auto rounded-none font-mono tabular-nums">{formatDistance(segment.distance)}</Badge>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-muted-foreground">
          <span>↑ {formatElevation(segment.ascent)}</span>
          <span>↓ {formatElevation(segment.descent)}</span>
          <span>min {formatElevation(segment.minEle)}</span>
          <span>max {formatElevation(segment.maxEle)}</span>
          <span className="col-span-2">pts {segment.start + 1}–{segment.end + 1} ({segment.points})</span>
        </div>
      </div>
      <Button
        size="icon-sm"
        variant="ghost"
        className="rounded-none"
        title="Export this segment"
        onClick={event => {
          event.stopPropagation();
          onExport();
        }}
      >
        <Download />
      </Button>
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

function visibleDistanceRange(map: Map, route: RouteData): DistanceRange | null {
  const canvas = map.getCanvas();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  let startIndex: number | null = null;
  let endIndex: number | null = null;
  let previous: { x: number; y: number; index: number } | null = null;

  for (const point of route.points) {
    const screenPoint = map.project([point.lon, point.lat]);
    const current = { x: screenPoint.x, y: screenPoint.y, index: point.index };
    if (pointInRect(current, width, height) || (previous && segmentIntersectsRect(previous, current, width, height))) {
      startIndex = startIndex ?? (previous?.index ?? current.index);
      endIndex = current.index;
    }
    previous = current;
  }

  if (startIndex === null || endIndex === null) return null;

  const start = route.points[startIndex]?.distance ?? 0;
  const end = route.points[endIndex]?.distance ?? start;
  if (end > start) return { start, end };

  const padding = route.totalDistance * 0.005;
  return {
    start: Math.max(0, start - padding),
    end: Math.min(route.totalDistance, end + padding),
  };
}

function pointInRect(point: { x: number; y: number }, width: number, height: number) {
  return point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height;
}

function segmentIntersectsRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
  width: number,
  height: number,
) {
  if (pointInRect(start, width, height) || pointInRect(end, width, height)) return true;
  return lineSegmentsIntersect(start, end, { x: 0, y: 0 }, { x: width, y: 0 })
    || lineSegmentsIntersect(start, end, { x: width, y: 0 }, { x: width, y: height })
    || lineSegmentsIntersect(start, end, { x: width, y: height }, { x: 0, y: height })
    || lineSegmentsIntersect(start, end, { x: 0, y: height }, { x: 0, y: 0 });
}

function lineSegmentsIntersect(
  firstStart: { x: number; y: number },
  firstEnd: { x: number; y: number },
  secondStart: { x: number; y: number },
  secondEnd: { x: number; y: number },
) {
  const direction = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) =>
    (c.x - a.x) * (b.y - a.y) - (b.x - a.x) * (c.y - a.y);
  const d1 = direction(secondStart, secondEnd, firstStart);
  const d2 = direction(secondStart, secondEnd, firstEnd);
  const d3 = direction(firstStart, firstEnd, secondStart);
  const d4 = direction(firstStart, firstEnd, secondEnd);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export default App;
