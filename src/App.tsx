import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Download, Route, Trash2, Upload } from "lucide-react";
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
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-border xl:grid-cols-[1fr_400px]">
          <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(132px,22vh)] gap-px bg-border">
            <div className="relative min-h-[260px] bg-background">
              <RouteMap
                route={route}
                splits={splits}
                hoverIndex={hoverIndex}
                activeSegment={activeSegment}
                onHover={setHoverIndex}
                onToggleSplit={toggleSplit}
              />
              <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-1.5 text-[11px]">
                <span className="bg-background/90 px-2 py-1 font-medium shadow-sm backdrop-blur">Click track to split</span>
                <span className="bg-background/90 px-2 py-1 font-medium shadow-sm backdrop-blur">Click marker to merge</span>
              </div>
            </div>
            <div className="flex min-h-[160px] flex-col bg-background">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
                <div className="text-xs font-semibold uppercase tracking-wide">Elevation profile</div>
                <Badge variant="outline" className="rounded-none font-mono tabular-nums">{route.points.length.toLocaleString()} pts</Badge>
              </div>
              <div className="min-h-0 flex-1 p-3">
                <ElevationProfile
                  route={route}
                  splits={splits}
                  hoverIndex={hoverIndex}
                  activeSegment={activeSegment}
                  onHover={setHoverIndex}
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
                  onHover={setHoverIndex}
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 180 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
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
  const elevations = points.map(point => point.ele).filter(ele => ele !== null);
  const minEle = elevations.length ? Math.min(...elevations) : 0;
  const maxEle = elevations.length ? Math.max(...elevations) : 1;
  const total = route?.totalDistance || 1;
  const yRange = Math.max(1, maxEle - minEle);
  const plotRight = width - padRight;
  const plotBottom = height - padBottom;
  const plotWidth = Math.max(1, plotRight - padLeft);
  const plotHeight = Math.max(1, height - padTop - padBottom);
  const x = (distance: number) => padLeft + (distance / total) * plotWidth;
  const y = (ele: number | null) => padTop + (1 - ((ele ?? minEle) - minEle) / yRange) * plotHeight;
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.distance).toFixed(2)},${y(point.ele).toFixed(2)}`).join(" ");
  const areaPath = `${path} L${plotRight},${plotBottom} L${padLeft},${plotBottom} Z`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(value => minEle + yRange * value);
  const hover = hoverIndex === null ? null : points[hoverIndex];
  const hoverX = hover ? x(hover.distance) : 0;
  const hoverY = hover ? y(hover.ele) : 0;
  const hoverLabelWidth = 138;
  const hoverLabelHeight = 32;
  const hoverLabelX = Math.min(width - hoverLabelWidth - 8, Math.max(padLeft + 8, hoverX + 10));
  const hoverLabelY = hoverY < 44 ? hoverY + 14 : hoverY - 36;

  function indexFromEvent(event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) {
    if (!route) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - rect.left) / Math.max(1, rect.width)) * width;
    const plotX = Math.max(padLeft, Math.min(plotRight, svgX));
    const ratio = (plotX - padLeft) / plotWidth;
    return nearestPoint(route.points, (ratio * route.totalDistance) / 1000);
  }

  return (
    <div ref={containerRef} className="h-full w-full">
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
        <linearGradient id="elevation-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.02" />
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
      {activeSegment && (
        <rect
          x={x(points[activeSegment.start]!.distance)}
          y={padTop}
          width={Math.max(2, x(points[activeSegment.end]!.distance) - x(points[activeSegment.start]!.distance))}
          height={plotHeight}
          rx="0"
          className="fill-primary/10"
        />
      )}
      <path d={areaPath} fill="url(#elevation-fill)" />
      <path d={path} className="fill-none stroke-foreground/80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {activeSegment && (
        <path
          d={points
            .slice(activeSegment.start, activeSegment.end + 1)
            .map((point, index) => `${index === 0 ? "M" : "L"}${x(point.distance).toFixed(2)},${y(point.ele).toFixed(2)}`)
            .join(" ")}
          className="fill-none stroke-primary"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {splits.map(index => (
        <g key={index}>
          <line x1={x(points[index]!.distance)} x2={x(points[index]!.distance)} y1={padTop} y2={plotBottom} className="stroke-destructive" strokeDasharray="4 4" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          <circle cx={x(points[index]!.distance)} cy={plotBottom} r="3.5" className="fill-destructive stroke-background" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </g>
      ))}
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
          </g>
        </>
      )}
      <text x={padLeft} y={height - 7} textAnchor="start" className="fill-muted-foreground font-mono text-[10px]">0.0 km</text>
      <text x={padLeft + plotWidth / 2} y={height - 7} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">{formatDistance(total / 2)}</text>
      <text x={plotRight} y={height - 7} textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">{formatDistance(total)}</text>
    </svg>
    </div>
  );
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

export default App;
