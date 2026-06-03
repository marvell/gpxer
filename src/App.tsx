import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import {
  clearSavedRouteState,
  loadSavedRouteState,
  sanitizeActiveSegmentId,
  sanitizeSplits,
  saveRouteState,
} from "@/lib/persistence";
import { Download, Route, Trash2, Upload, X } from "lucide-react";
import maplibregl, { type GeoJSONSource, type Map } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./index.css";

export function App() {
  const [route, setRoute] = useState<RouteData | null>(null);
  const [sourceGpxText, setSourceGpxText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [splits, setSplits] = useState<number[]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<number | null>(null);
  const [mapDistanceRange, setMapDistanceRange] = useState<DistanceRange | null>(null);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const hoverIndexRef = useRef<number | null>(null);
  const mapDistanceRangeRef = useRef<DistanceRange | null>(null);
  const segments = useMemo(() => (route ? buildSegments(route.points, splits) : []), [route, splits]);
  const activeSegment = segments.find(segment => segment.id === activeSegmentId) ?? null;
  const maxSegmentDistance = Math.max(0, ...segments.map(segment => segment.distance));
  const maxSegmentAscent = Math.max(0, ...segments.map(segment => segment.ascent));
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
    setActiveSegmentId(current => (segments.some(segment => segment.id === current) ? current : (segments[0]?.id ?? null)));
  }, [segments.length]);

  useEffect(() => {
    let cancelled = false;

    async function restoreSavedRoute() {
      const saved = await loadSavedRouteState();
      if (cancelled) return;

      if (saved) {
        try {
          const parsed = parseGpx(saved.gpxText, saved.fileName);
          const restoredSplits = sanitizeSplits(saved.splits, parsed.points.length);
          const restoredSegments = buildSegments(parsed.points, restoredSplits);
          setSourceGpxText(saved.gpxText);
          setRoute(parsed);
          setSplits(restoredSplits);
          setActiveSegmentId(sanitizeActiveSegmentId(saved.activeSegmentId, restoredSegments.length));
          setError(null);
        } catch {
          await clearSavedRouteState();
        }
      }

      if (!cancelled) setPersistenceReady(true);
    }

    void restoreSavedRoute();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!persistenceReady || !route || !sourceGpxText) return;
    void saveRouteState({
      version: 1,
      gpxText: sourceGpxText,
      fileName: route.fileName,
      splits: sanitizeSplits(splits, route.points.length),
      activeSegmentId: sanitizeActiveSegmentId(activeSegmentId, segments.length),
    });
  }, [activeSegmentId, persistenceReady, route, segments.length, sourceGpxText, splits]);

  async function onUpload(file: File | undefined) {
    if (!file) return;
    try {
      const gpxText = await file.text();
      const parsed = parseGpx(gpxText, file.name);
      setSourceGpxText(gpxText);
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

  async function forgetRoute() {
    await clearSavedRouteState();
    setRoute(null);
    setSourceGpxText(null);
    setSplits([]);
    setHoverIndexIfChanged(null);
    setMapDistanceRangeIfChanged(null);
    setActiveSegmentId(null);
    setError(null);
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

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-muted/40 text-sm">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-background px-4">
        <div className="flex items-center gap-2.5">
          <div className="grid size-8 place-items-center bg-primary text-primary-foreground">
            <Route className="size-4" />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="whitespace-nowrap text-sm font-semibold tracking-tight">GPX Splitter</div>
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
          <Button variant="outline" size="sm" onClick={() => route && setSplits([])} disabled={!route || splits.length === 0}>
            <Trash2 />
            <span className="hidden sm:inline">Clear splits</span>
          </Button>
          <Button variant="outline" size="sm" onClick={forgetRoute} disabled={!route}>
            <X />
            <span className="hidden sm:inline">Forget route</span>
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
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-px bg-border lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="grid min-h-0 min-w-0 grid-rows-[minmax(260px,1fr)_minmax(168px,22vh)] gap-px bg-border">
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
                <span className={HINT_CHIP_CLASS}>Click track to split</span>
                <span className={HINT_CHIP_CLASS}>Click marker to merge</span>
              </div>
            </div>
            <div className="flex min-h-[160px] min-w-0 flex-col bg-background">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
                <div className="text-xs font-semibold uppercase tracking-wide">Elevation profile</div>
                <SlopeLegend />
              </div>
              <div className="min-h-0 min-w-0 flex-1 px-2 pb-1.5 pt-3">
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
              <Badge variant="secondary" className="font-mono tabular-nums">{segments.length} total</Badge>
            </div>

            <div className="flex flex-col gap-2 border-b px-4 py-3">
              <Button size="sm" variant="outline" className="w-full" onClick={() => downloadSegments(segments)} disabled={!segments.length}>
                <Download />
                Export all
              </Button>
            </div>

            <TooltipProvider>
              <div className="min-h-0 flex-1 space-y-1.5 overflow-auto p-2">
                {segments.map(segment => (
                  <SegmentRow
                    key={segment.id}
                    segment={segment}
                    distanceBalance={maxSegmentDistance > 0 ? segment.distance / maxSegmentDistance : 0}
                    climbBalance={maxSegmentAscent > 0 ? segment.ascent / maxSegmentAscent : 0}
                    active={segment.id === activeSegmentId}
                    onSelect={() => setActiveSegmentId(segment.id)}
                    onExport={() => downloadSegments([segment])}
                  />
                ))}
              </div>
            </TooltipProvider>
          </aside>
        </div>
      )}
    </main>
  );
}

const GPX_ACCEPT = ".gpx,application/gpx+xml,text/xml,application/xml";
const HINT_CHIP_CLASS = "rounded-[2px] border bg-background/90 px-2 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur";
const SEGMENT_MARKER_CLASS = "grid size-5 shrink-0 place-items-center rounded-[1px] border-2 border-background bg-destructive font-mono text-[10px] font-bold leading-none text-white";
type DistanceRange = { start: number; end: number };
type ProfilePoint = Pick<RouteData["points"][number], "distance" | "ele">;
type ProfileSlopeSegment = ReturnType<typeof calculateProfileSlopeSegments>[number];

function cssColor(variable: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return /^(#|rgb\(|rgba\(|hsl\(|hsla\()/i.test(value) ? value : fallback;
}

function mapSplitMarkerImage(fill: string, stroke: string) {
  const size = 22;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = stroke;
  context.fillRect(0, 0, size, size);
  context.fillStyle = fill;
  context.fillRect(2, 2, size - 4, size - 4);
  return context.getImageData(0, 0, size, size);
}

function UploadButton({ onFile, variant }: { onFile: (file: File | undefined) => void; variant: "default" | "outline" }) {
  return (
    <Button asChild size="sm" variant={variant}>
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

function SlopeLegend() {
  const bounds = SLOPE_CLASSES.slice(0, -1).map(slopeClass => slopeClass.maxSlope);
  return (
    <div className="ml-auto hidden min-w-0 items-center justify-end gap-2 sm:flex">
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Slope</span>
      <div className="flex w-[260px] max-w-[40vw] flex-col gap-0.5">
        <div className="grid h-2 overflow-hidden rounded-[1px] border" style={{ gridTemplateColumns: `repeat(${SLOPE_CLASSES.length}, minmax(0, 1fr))` }}>
          {SLOPE_CLASSES.map(slopeClass => (
            <span key={slopeClass.label} style={{ backgroundColor: slopeClass.color }} />
          ))}
        </div>
        <div className="relative h-3.5 font-mono text-[9px] leading-none text-muted-foreground tabular-nums">
          {bounds.map((bound, index) => (
            <span
              key={bound}
              className="absolute top-0 min-w-7 -translate-x-1/2 whitespace-nowrap text-center"
              style={{ left: `${((index + 1) / SLOPE_CLASSES.length) * 100}%` }}
            >
              {bound > 0 ? `+${bound}%` : `${bound}%`}
            </span>
          ))}
        </div>
      </div>
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
        className={`flex w-full max-w-xl cursor-pointer flex-col items-center gap-5 border-2 border-dashed p-6 text-center transition-colors sm:p-12 ${drag ? "border-primary bg-muted" : "border-border bg-background hover:bg-muted/50"}`}
      >
        <div className="grid size-14 place-items-center border bg-muted">
          <Upload className="size-6 text-muted-foreground" />
        </div>
        <div>
          <div className="text-base font-semibold">Drop a GPX file here</div>
          <div className="mt-1 text-sm text-muted-foreground">or click to browse — split a route into multi-day segments</div>
        </div>
        <div className="flex flex-wrap justify-center gap-2 text-[11px] text-muted-foreground">
          <span className={HINT_CHIP_CLASS}>Click track to split</span>
          <span className={HINT_CHIP_CLASS}>Click marker to merge</span>
          <span className={HINT_CHIP_CLASS}>Export unchanged GPX</span>
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
  const splitPointData = useMemo(() => (route ? splitPointDataForRoute(route, splits) : emptyPoints().data), [route, splits]);
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
      const routeColor = cssColor("--primary", "#0072bb");
      const activeColor = cssColor("--ring", "#1e91d6");
      const backgroundColor = cssColor("--background", "#fff");
      const splitColor = cssColor("--destructive", "#e18335");
      const splitMarkerImage = mapSplitMarkerImage(splitColor, backgroundColor);
      if (splitMarkerImage && !map.hasImage("split-marker")) {
        map.addImage("split-marker", splitMarkerImage);
      }
      map.addLayer({ id: "route-line", type: "line", source: "route", paint: { "line-color": routeColor, "line-width": 4 } });
      map.addLayer({ id: "active-segment-line", type: "line", source: "active-segment", paint: { "line-color": activeColor, "line-width": 7, "line-opacity": 0.9 } });
      map.addLayer({ id: "route-hit", type: "line", source: "route", paint: { "line-color": "#000", "line-opacity": 0.01, "line-width": 28 } });
      map.addLayer({ id: "hover-point", type: "circle", source: "hover", paint: { "circle-radius": 7, "circle-color": activeColor, "circle-stroke-width": 2, "circle-stroke-color": backgroundColor } });
      map.addLayer({
        id: "split-points",
        type: "symbol",
        source: "splits",
        layout: {
          "icon-image": "split-marker",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-size": 11,
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: { "text-color": "#fff" },
      });

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
      const crosshair = () => {
        map.getCanvas().style.cursor = "crosshair";
      };
      const pointer = () => {
        map.getCanvas().style.cursor = "pointer";
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
      map.on("mouseenter", "route-hit", crosshair);
      map.on("mouseenter", "split-points", pointer);
      map.on("mouseenter", "hover-point", crosshair);
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
  }, [route, splitPointData, splits]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route) return;
    const update = () => (map.getSource("hover") as GeoJSONSource | undefined)?.setData(hoverPointData);
    map.getSource("hover") ? update() : map.once("load", update);
  }, [route, hoverPointData]);

  return (
    <div className="relative h-full min-h-0">
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
  const padLeft = 46;
  const padRight = 10;
  const padTop = 8;
  const padBottom = 22;
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
      <rect x="0" y="0" width={width} height={height} rx="0" className="fill-background" />
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
      {splits
        .map((index, splitPosition) => {
          if (points[index]!.distance < profileRange.start || points[index]!.distance > profileRange.end) return null;
          const label = String(splitPosition + 1);
          const splitX = x(points[index]!.distance);
          const markerSize = label.length > 1 ? 20 : 16;
          return (
            <g key={index}>
              <line x1={splitX} x2={splitX} y1={padTop} y2={plotBottom} className="stroke-destructive" strokeDasharray="4 4" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              <rect x={splitX - markerSize / 2} y={plotBottom - markerSize / 2} width={markerSize} height={markerSize} rx="1" className="fill-destructive stroke-background" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              <text x={splitX} y={plotBottom} textAnchor="middle" dominantBaseline="middle" className="fill-white font-mono text-[10px] font-bold">
                {label}
              </text>
            </g>
          );
        })}
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

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function SegmentRow({
  segment,
  distanceBalance,
  climbBalance,
  active,
  onSelect,
  onExport,
}: {
  segment: Segment;
  distanceBalance: number;
  climbBalance: number;
  active: boolean;
  onSelect: () => void;
  onExport: () => void;
}) {
  const uphillDistance = segment.slopeDistances.slice(4).reduce((total, item) => total + item.distance, 0);
  const uphillPercent = segment.distance > 0 ? (uphillDistance / segment.distance) * 100 : 0;

  return (
    <div
      className={`relative w-full rounded-[2px] border bg-background ${active ? "border-primary bg-muted/60" : "border-border"}`}
    >
      <button type="button" className="w-full cursor-pointer p-2.5 text-left" onClick={onSelect}>
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2 pr-8">
              <span className={SEGMENT_MARKER_CLASS}>
                {segment.id}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold leading-5">{segment.name}</div>
                <div className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {formatDistance(segment.startDistance)} → {formatDistance(segment.endDistance)}
                </div>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <SegmentMetric label="Distance" value={formatDistance(segment.distance)} progress={distanceBalance} strong />
              <SegmentMetric
                label="Climb"
                value={`↑ ${formatElevation(segment.ascent)}`}
                progress={climbBalance}
              />
              <SegmentMetric label="Drop" value={`↓ ${formatElevation(segment.descent)}`} />
            </div>

            <UphillSummary percent={uphillPercent} distance={uphillDistance} />

            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <SegmentMetric label="Lowest" value={formatElevation(segment.minEle)} />
              <SegmentMetric label="Highest" value={formatElevation(segment.maxEle)} />
            </div>

            <div className="mt-2 overflow-hidden rounded-[2px] border bg-muted">
              <div className="flex h-6 w-full">
                {segment.slopeDistances.filter(item => item.distance > 0).map(item => {
                  const percent = segment.distance > 0 ? (item.distance / segment.distance) * 100 : 0;
                  const label = `${formatPercent(percent)} · ${formatDistance(item.distance)}`;
                  return (
                    <Tooltip key={item.label}>
                      <TooltipTrigger asChild>
                        <div
                          className="grid min-w-0 place-items-center overflow-hidden font-mono text-[10px] font-bold leading-none text-black/70 tabular-nums"
                          style={{ flexBasis: `${percent}%`, backgroundColor: item.color }}
                          aria-label={`${item.label}: ${label}`}
                        >
                          {percent >= 10 ? formatPercent(percent) : null}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="font-mono tabular-nums">
                          <div>{item.label}</div>
                          <div>{label}</div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </button>
      <Button
        size="icon-sm"
        variant="ghost"
        title="Export this segment"
        className="absolute right-2.5 top-2.5 opacity-70"
        onClick={onExport}
      >
        <Download />
      </Button>
    </div>
  );
}

function SegmentMetric({
  label,
  value,
  progress,
  strong = false,
}: {
  label: string;
  value: string;
  progress?: number;
  strong?: boolean;
}) {
  return (
    <div className="relative overflow-hidden rounded-[2px] border bg-background px-2 py-1.5">
      {progress !== undefined && (
        <div className="absolute inset-y-0 left-0 bg-primary/15" style={{ width: `${Math.max(0, Math.min(progress, 1)) * 100}%` }} />
      )}
      <div className="relative text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`relative mt-0.5 font-mono text-xs tabular-nums ${strong ? "font-bold text-foreground" : "text-foreground/85"}`}>{value}</div>
    </div>
  );
}

function UphillSummary({ percent, distance }: { percent: number; distance: number }) {
  return (
    <div className="mt-1.5 grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-[2px] border bg-background px-2 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Uphill &gt;1%</div>
      <div className="h-1.5 overflow-hidden rounded-[1px] bg-muted">
        <div className="h-full bg-chart-4/70" style={{ width: `${Math.max(0, Math.min(percent, 100))}%` }} />
      </div>
      <div className="font-mono text-[11px] font-semibold tabular-nums">
        {formatPercent(percent)} · {formatDistance(distance)}
      </div>
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

function pointData(
  route: RouteData,
  indexes: number[],
  propertiesForIndex: (index: number, position: number) => GeoJSON.GeoJsonProperties = index => ({ index }),
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: indexes.map((index, position) => ({
      type: "Feature",
      properties: propertiesForIndex(index, position),
      geometry: { type: "Point", coordinates: [route.points[index]!.lon, route.points[index]!.lat] },
    })),
  };
}

function splitPointDataForRoute(route: RouteData, indexes: number[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return pointData(route, indexes, (index, splitPosition) => ({ index, label: String(splitPosition + 1) }));
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
