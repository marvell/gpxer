import { usePostHog } from "@posthog/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  buildSegments,
  calculateCumulativeSpeedTimes,
  calculateElevationChange,
  calculateProfileSlopeSegments,
  calculateRouteSpeed,
  calculateSegmentSpeed,
  downloadText,
  exportSegmentGpx,
  DEFAULT_SPEED_MODEL_SETTINGS,
  formatDistance,
  formatElevation,
  formatMovingTime,
  formatSpeed,
  getSlopeColor,
  getSlopeLabel,
  getSlopeName,
  nearestPoint,
  parseGpx,
  safeFileName,
  SPEED_MODEL_LIMITS,
  SLOPE_CLASSES,
  type RouteData,
  type Segment,
  type SpeedEstimate,
  type SpeedModelSettings,
  type Waypoint,
  updateGpxRouteName,
} from "@/lib/gpx";
import {
  clearSavedRouteState,
  loadSavedRouteState,
  loadSavedSpeedSettingsState,
  sanitizeActiveSegmentId,
  sanitizeSplits,
  saveRouteState,
  saveSpeedSettingsState,
  type SavedSpeedSettingsState,
} from "@/lib/persistence";
import { clamp } from "@/lib/utils";
import { Download, Eye, EyeOff, Pencil, Route, Trash2, Upload, X } from "lucide-react";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import "./index.css";

const DEFAULT_SPEED_PREFERENCES: SavedSpeedSettingsState = {
  version: 1,
  enabled: false,
  settings: DEFAULT_SPEED_MODEL_SETTINGS,
};

export function App() {
  const posthogClient: ReturnType<typeof usePostHog> = usePostHog();
  const [route, setRoute] = useState<RouteData | null>(null);
  const [sourceGpxText, setSourceGpxText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [splits, setSplits] = useState<number[]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showWaypoints, setShowWaypoints] = useState(true);
  const [activeWaypointIndex, setActiveWaypointIndex] = useState<number | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<number | null>(null);
  const [mapDistanceRange, setMapDistanceRange] = useState<DistanceRange | null>(null);
  const [speedPreferences, setSpeedPreferences] = useState<SavedSpeedSettingsState>(() => loadSavedSpeedSettingsState() ?? DEFAULT_SPEED_PREFERENCES);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<ConfirmationAction | null>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const mapDistanceRangeRef = useRef<DistanceRange | null>(null);
  const savedSpeedPreferencesRef = useRef(JSON.stringify(speedPreferences));
  const speedModelEnabled = speedPreferences.enabled;
  const speedSettings = speedPreferences.settings;
  const segments = useMemo(() => (route ? buildSegments(route.points, splits) : []), [route, splits]);
  const routeSpeed = useMemo(() => (route && speedModelEnabled ? calculateRouteSpeed(route.points, speedSettings) : null), [route, speedModelEnabled, speedSettings]);
  const segmentSpeeds = useMemo(
    () => route && speedModelEnabled ? new Map(segments.map(segment => [segment.id, calculateSegmentSpeed(route.points, segment, speedSettings)])) : new Map<number, SpeedEstimate>(),
    [route, segments, speedModelEnabled, speedSettings],
  );
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
          setShowWaypoints(saved.showWaypoints);
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
      showWaypoints,
    });
  }, [activeSegmentId, persistenceReady, route, segments.length, showWaypoints, sourceGpxText, splits]);

  useEffect(() => {
    const serialized = JSON.stringify(speedPreferences);
    if (savedSpeedPreferencesRef.current === serialized) return;
    savedSpeedPreferencesRef.current = serialized;
    saveSpeedSettingsState(speedPreferences);
  }, [speedPreferences]);

  useEffect(() => {
    if (!route || activeWaypointIndex === null) return;
    if (!route.waypoints.some(waypoint => waypoint.index === activeWaypointIndex)) setActiveWaypointIndex(null);
  }, [activeWaypointIndex, route]);

  async function onUpload(file: File | undefined, source: GpxUploadSource) {
    if (!file) return;
    posthogClient?.capture(GPX_UPLOAD_STARTED_EVENT, { source });
    try {
      const gpxText = await file.text();
      const parsed = parseGpx(gpxText, file.name);
      posthogClient?.capture(GPX_UPLOAD_SUCCEEDED_EVENT, routeAnalyticsProperties(parsed, 0));
      setSourceGpxText(gpxText);
      setRoute(parsed);
      setSplits([]);
      setShowWaypoints(true);
      setActiveWaypointIndex(null);
      setHoverIndexIfChanged(null);
      setMapDistanceRangeIfChanged(null);
      setActiveSegmentId(1);
      setPendingConfirmation(null);
      setError(null);
    } catch (reason) {
      posthogClient?.capture(GPX_UPLOAD_FAILED_EVENT, { source });
      setError(reason instanceof Error ? reason.message : "Could not parse GPX file.");
    }
  }

  async function forgetRoute() {
    if (route) {
      posthogClient?.capture(GPX_ROUTE_CLOSED_EVENT, routeAnalyticsProperties(route, splits.length));
    }
    await clearSavedRouteState();
    setRoute(null);
    setSourceGpxText(null);
    setSplits([]);
    setShowWaypoints(true);
    setActiveWaypointIndex(null);
    setHoverIndexIfChanged(null);
    setMapDistanceRangeIfChanged(null);
    setActiveSegmentId(null);
    setPendingConfirmation(null);
    setError(null);
  }

  function confirmOrRun(action: ConfirmationAction, run: () => void) {
    if (segments.length > 1 && pendingConfirmation !== action) {
      setPendingConfirmation(action);
      return;
    }
    setPendingConfirmation(null);
    run();
  }

  function resetConfirmation(action: ConfirmationAction) {
    setPendingConfirmation(current => (current === action ? null : current));
  }

  function toggleSplit(index: number) {
    if (!route || index <= 0 || index >= route.points.length - 1) return;
    const exists = splits.includes(index);
    const nextSplits = exists ? splits.filter(split => split !== index) : [...splits, index].sort((a, b) => a - b);
    posthogClient?.capture(exists ? GPX_SPLIT_REMOVED_EVENT : GPX_SPLIT_ADDED_EVENT, routeAnalyticsProperties(route, nextSplits.length));
    const sortedCurrent = [...splits].sort((a, b) => a - b);
    const splitPosition = exists ? sortedCurrent.indexOf(index) + 1 : nextSplits.indexOf(index) + 1;
    setActiveSegmentId(Math.max(1, splitPosition));
    setSplits(nextSplits);
  }

  function downloadSegments(targetSegments: Segment[], source: GpxExportSource) {
    if (!route) return;
    posthogClient?.capture(source === "all" ? GPX_EXPORT_ALL_CLICKED_EVENT : GPX_EXPORT_SEGMENT_CLICKED_EVENT, {
      ...routeAnalyticsProperties(route, splits.length),
      exported_segments: targetSegments.length,
    });
    targetSegments.forEach(segment => {
      downloadText(`${safeFileName(route.name)}-${String(segment.id).padStart(2, "0")}.gpx`, exportSegmentGpx(route, segment));
    });
  }

  function updateRouteName(name: string) {
    if (!route || !sourceGpxText) return;
    try {
      const updatedText = updateGpxRouteName(sourceGpxText, name);
      const nextName = name.trim();
      setSourceGpxText(updatedText);
      setRoute(current => current ? { ...current, name: nextName } : current);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update GPX route name.");
    }
  }

  return (
    <TooltipProvider delayDuration={700} skipDelayDuration={0}>
      <main className="flex h-screen flex-col overflow-hidden bg-muted/40 text-sm">
        <header className="flex h-14 shrink-0 items-center gap-4 border-b bg-background px-4">
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center bg-primary text-primary-foreground">
              <Route className="size-4" />
            </div>
            <div className="min-w-0 leading-tight">
              <div className="whitespace-nowrap text-sm font-semibold tracking-tight">GPXer</div>
              {route ? (
                <RouteNameEditor name={route.name} onChange={updateRouteName} />
              ) : (
                <div className="max-w-[200px] truncate text-[11px] text-muted-foreground">No file loaded</div>
              )}
            </div>
          </div>

          {route && (
            <div className="ml-2 hidden items-stretch border lg:flex">
              <StatPill label="Dist" value={formatDistance(route.totalDistance)} help="Total route distance from the GPX track points." />
              {routeSpeed && (
                <>
                  <StatPill label="Est. time" value={formatMovingTime(routeSpeed.movingTimeSeconds)} help="Estimated moving time from your speed settings." />
                  <StatPill label="Est. speed" value={formatSpeed(routeSpeed.averageSpeedMps)} help="Estimated average moving speed from your speed settings." />
                </>
              )}
              <StatPill label="Asc" value={formatElevation(route.ascent)} help="Total ascent calculated from GPX elevation data." />
              <StatPill label="Desc" value={formatElevation(route.descent)} help="Total descent calculated from GPX elevation data." />
              <StatPill label="Seg" value={String(segments.length)} help="Number of exportable route parts. Cuts + 1." />
              <StatPill label="Cuts" value={String(splits.length)} help="Split points you added on the map or elevation profile." last />
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <HelpTooltip content="Remove all split points. The loaded GPX route stays open.">
              <span className="inline-flex">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => route && confirmOrRun(CONFIRMATION_ACTION.clear, () => {
                    posthogClient?.capture(GPX_SPLITS_CLEARED_EVENT, routeAnalyticsProperties(route, 0));
                    setSplits([]);
                  })}
                  onMouseLeave={() => resetConfirmation(CONFIRMATION_ACTION.clear)}
                  disabled={!route || splits.length === 0}
                >
                  <Trash2 />
                  <span className="hidden sm:inline">{pendingConfirmation === CONFIRMATION_ACTION.clear ? CONFIRM_LABEL : "Clear splits"}</span>
                </Button>
              </span>
            </HelpTooltip>
            <HelpTooltip content="Close this route and remove its saved local copy from this browser.">
              <span className="inline-flex">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => confirmOrRun(CONFIRMATION_ACTION.forget, () => void forgetRoute())}
                  onMouseLeave={() => resetConfirmation(CONFIRMATION_ACTION.forget)}
                  disabled={!route}
                >
                  <X />
                  <span className="hidden sm:inline">{pendingConfirmation === CONFIRMATION_ACTION.forget ? CONFIRM_LABEL : "Forget route"}</span>
                </Button>
              </span>
            </HelpTooltip>
            <UploadButton
              onFile={onUpload}
              variant={route ? "outline" : "default"}
              confirmation={{
                required: segments.length > 1,
                active: pendingConfirmation === CONFIRMATION_ACTION.upload,
                request: () => setPendingConfirmation(CONFIRMATION_ACTION.upload),
                clear: () => resetConfirmation(CONFIRMATION_ACTION.upload),
              }}
            />
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
                showWaypoints={showWaypoints}
                activeWaypointIndex={activeWaypointIndex}
                activeSegment={activeSegment}
                onHover={setHoverIndexIfChanged}
                onToggleSplit={toggleSplit}
                onSelectWaypoint={setActiveWaypointIndex}
                onVisibleRange={setMapDistanceRangeIfChanged}
              />
              <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-1.5 text-[11px]">
                <span className={HINT_CHIP_CLASS}>Click map or profile to split</span>
                <span className={HINT_CHIP_CLASS}>Click split marker to remove</span>
              </div>
              {route.waypoints.length > 0 && (
                <div className="absolute left-3 top-3">
                  <HelpTooltip content={showWaypoints ? "Hide waypoint markers on the map and elevation profile." : "Show waypoint markers on the map and elevation profile."}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-background/90 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
                      onClick={() => setShowWaypoints(current => !current)}
                      aria-pressed={showWaypoints}
                    >
                      {showWaypoints ? <EyeOff /> : <Eye />}
                      {showWaypoints ? "Hide markers" : "Show markers"}
                    </Button>
                  </HelpTooltip>
                </div>
              )}
            </div>
            <div className="flex min-h-[160px] min-w-0 flex-col bg-background">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
                <SectionTitle
                  title="Elevation profile"
                  help="The chart shows route elevation over distance. Colors show slope ranges; click the chart to add or remove a split."
                />
                <SlopeLegend />
              </div>
              <div className="min-h-0 min-w-0 flex-1 px-2 pb-1.5 pt-3">
                <ElevationProfile
                  route={route}
                  segments={segments}
                  splits={splits}
                  hoverIndex={hoverIndex}
                  speedSettings={speedModelEnabled ? speedSettings : null}
                  showWaypoints={showWaypoints}
                  activeWaypointIndex={activeWaypointIndex}
                  activeSegment={activeSegment}
                  focusRange={mapDistanceRange}
                  onHover={setHoverIndexIfChanged}
                  onToggleSplit={toggleSplit}
                  onSelectWaypoint={setActiveWaypointIndex}
                />
              </div>
            </div>
          </div>

          <aside className="flex min-h-0 flex-col bg-background">
            <SpeedSettingsPanel
              enabled={speedModelEnabled}
              settings={speedSettings}
              onEnabledChange={enabled => setSpeedPreferences(current => current.enabled === enabled ? current : { ...current, enabled })}
              onSettingsChange={settings => setSpeedPreferences(current => current.settings === settings ? current : { ...current, settings })}
            />
            <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
              <SectionTitle title="Segments" help="Click a segment to highlight it on the map and profile." />
              <Badge variant="secondary" className="font-mono tabular-nums">{segments.length} total</Badge>
            </div>

            <div className="flex flex-col gap-2 border-b px-4 py-3">
              <HelpTooltip content={splits.length === 0 ? "Download the unchanged route as one GPX file." : "Download one GPX file for each segment."}>
                <span className="inline-flex w-full">
                  <Button size="sm" variant="outline" className="w-full" onClick={() => downloadSegments(segments, "all")} disabled={!segments.length}>
                    <Download />
                    Export all
                  </Button>
                </span>
              </HelpTooltip>
            </div>

            <div className="min-h-0 flex-1 space-y-1.5 overflow-auto p-2">
              {segments.map(segment => (
                <SegmentRow
                  key={segment.id}
                  segment={segment}
                  speed={segmentSpeeds.get(segment.id)}
                  distanceBalance={maxSegmentDistance > 0 ? segment.distance / maxSegmentDistance : 0}
                  climbBalance={maxSegmentAscent > 0 ? segment.ascent / maxSegmentAscent : 0}
                  active={segment.id === activeSegmentId}
                  onSelect={() => setActiveSegmentId(segment.id)}
                  onExport={() => downloadSegments([segment], "segment")}
                />
              ))}
            </div>
          </aside>
        </div>
      )}
      </main>
    </TooltipProvider>
  );
}

const GPX_ACCEPT = ".gpx,application/gpx+xml,text/xml,application/xml";
const CONFIRM_LABEL = "Confirm?";
const CONFIRMATION_ACTION = {
  clear: "clear",
  forget: "forget",
  upload: "upload",
} as const;
const CDA_OPTIONS = [
  { label: "Aero road · 0.28", value: 0.28 },
  { label: "Road drops · 0.32", value: 0.32 },
  { label: "Road hoods · 0.36", value: 0.36 },
  { label: "Endurance · 0.38", value: 0.38 },
  { label: "Upright · 0.42", value: 0.42 },
  { label: "Very upright · 0.50", value: 0.5 },
] as const;
const CRR_OPTIONS = [
  { label: "Fast tires · 0.0045", value: 0.0045 },
  { label: "Good asphalt · 0.0055", value: 0.0055 },
  { label: "Normal asphalt · 0.0065", value: 0.0065 },
  { label: "Rough asphalt · 0.0075", value: 0.0075 },
  { label: "Bad road · 0.0100", value: 0.01 },
  { label: "Gravel · 0.0150", value: 0.015 },
] as const;
const HINT_CHIP_CLASS = "rounded-[2px] border bg-background/90 px-2 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur";
const SEGMENT_MARKER_CLASS = "grid size-5 shrink-0 place-items-center rounded-[1px] border-2 border-background bg-destructive font-mono text-[10px] font-bold leading-none text-white";
type DistanceRange = { start: number; end: number };
type ConfirmationAction = (typeof CONFIRMATION_ACTION)[keyof typeof CONFIRMATION_ACTION];
type GpxUploadSource = "dropzone" | "file-picker";
type GpxExportSource = "all" | "segment";
type ConfirmationState = {
  required: boolean;
  active: boolean;
  request: () => void;
  clear: () => void;
};
type ProfilePoint = Pick<RouteData["points"][number], "distance" | "ele">;
type ProfileSlopeSegment = ReturnType<typeof calculateProfileSlopeSegments>[number];

const GPX_UPLOAD_STARTED_EVENT = "gpx_upload_started";
const GPX_UPLOAD_SUCCEEDED_EVENT = "gpx_upload_succeeded";
const GPX_UPLOAD_FAILED_EVENT = "gpx_upload_failed";
const GPX_SPLIT_ADDED_EVENT = "gpx_split_added";
const GPX_SPLIT_REMOVED_EVENT = "gpx_split_removed";
const GPX_SPLITS_CLEARED_EVENT = "gpx_splits_cleared";
const GPX_ROUTE_CLOSED_EVENT = "gpx_route_closed";
const GPX_EXPORT_ALL_CLICKED_EVENT = "gpx_export_all_clicked";
const GPX_EXPORT_SEGMENT_CLICKED_EVENT = "gpx_export_segment_clicked";

function routeAnalyticsProperties(route: RouteData, splitCount: number) {
  return {
    point_count: route.points.length,
    split_count: splitCount,
    waypoint_count: route.waypoints.length,
    segment_count: splitCount + 1,
    total_distance_m: Math.round(route.totalDistance),
    ascent_m: Math.round(route.ascent),
    descent_m: Math.round(route.descent),
  };
}

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

function UploadButton({
  onFile,
  variant,
  confirmation,
}: {
  onFile: (file: File | undefined, source: GpxUploadSource) => void;
  variant: "default" | "outline";
  confirmation: ConfirmationState;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  function openFilePicker() {
    if (confirmation.required && !confirmation.active) {
      confirmation.request();
      return;
    }
    confirmation.clear();
    inputRef.current?.click();
  }

  return (
    <HelpTooltip content="Open a GPX track file from your device. Processing happens in this browser.">
      <Button size="sm" variant={variant} onClick={openFilePicker} onMouseLeave={confirmation.clear}>
        <Upload />
        {confirmation.active ? CONFIRM_LABEL : "Upload GPX"}
        <input ref={inputRef} type="file" accept={GPX_ACCEPT} className="sr-only" onChange={event => onFile(event.currentTarget.files?.[0], "file-picker")} />
      </Button>
    </HelpTooltip>
  );
}

function StatPill({ label, value, help, last }: { label: string; value: string; help: string; last?: boolean }) {
  return (
    <HelpTooltip content={help}>
      <div className={`flex flex-col justify-center px-3 py-1 ${last ? "" : "border-r"}`}>
        <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="font-mono text-xs font-semibold tabular-nums leading-tight">{value}</span>
      </div>
    </HelpTooltip>
  );
}

function RouteNameEditor({ name, onChange }: { name: string; onChange: (name: string) => void }) {
  const inputId = useId();
  const cancelingRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  function commit() {
    if (cancelingRef.current) {
      cancelingRef.current = false;
      return;
    }
    const next = draft.trim();
    if (!next) {
      setDraft(name);
      setEditing(false);
      return;
    }
    if (next !== name) onChange(next);
    setEditing(false);
  }

  function startEditing() {
    cancelingRef.current = false;
    setDraft(name);
    setEditing(true);
  }

  function cancel() {
    cancelingRef.current = true;
    setDraft(name);
    setEditing(false);
  }

  return (
    <div className="group flex max-w-[240px] items-center gap-1">
      {!editing ? (
        <>
          <div className="truncate text-[11px] text-muted-foreground">{name}</div>
          <HelpTooltip content="Edit the GPX track name used in saved data and exported segment files.">
            <Button
              size="icon"
              variant="ghost"
              aria-label="Edit route name"
              className="size-5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              onClick={startEditing}
            >
              <Pencil className="size-3" />
            </Button>
          </HelpTooltip>
        </>
      ) : (
        <Input
          id={inputId}
          aria-label="Route name"
          value={draft}
          autoFocus
          onChange={event => setDraft(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={event => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
          className="h-7 w-[240px] text-xs"
        />
      )}
    </div>
  );
}

function SpeedSettingsPanel({
  enabled,
  settings,
  onEnabledChange,
  onSettingsChange,
}: {
  enabled: boolean;
  settings: SpeedModelSettings;
  onEnabledChange: (enabled: boolean) => void;
  onSettingsChange: (settings: SpeedModelSettings) => void;
}) {
  function update<Key extends keyof SpeedModelSettings>(key: Key, value: number) {
    if (Object.is(settings[key], value)) return;
    onSettingsChange({ ...settings, [key]: value });
  }

  return (
    <div className="border-b px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <SectionTitle title="Speed estimate" help="Enable custom settings to estimate moving time and average speed." />
        <Label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Checkbox checked={enabled} onCheckedChange={checked => onEnabledChange(checked === true)} />
          Enable
        </Label>
      </div>

      {enabled && (
        <div className="grid grid-cols-2 gap-2">
          <SpeedNumberInput
            label="Power"
            help="Sustained rider power in watts. Higher power makes climbs and flats faster."
            value={settings.powerWatts}
            suffix="W"
            min={SPEED_MODEL_LIMITS.powerWatts.min}
            max={SPEED_MODEL_LIMITS.powerWatts.max}
            step={5}
            onChange={value => update("powerWatts", value)}
          />
          <SpeedNumberInput
            label="Mass"
            help="Total system mass: rider, bike, bottles, bags, and gear. Higher mass slows climbs."
            value={settings.massKg}
            suffix="kg"
            min={SPEED_MODEL_LIMITS.massKg.min}
            max={SPEED_MODEL_LIMITS.massKg.max}
            step={1}
            onChange={value => update("massKg", value)}
          />
          <SpeedSelectInput
            label="Aero position"
            help="CdA: aerodynamic drag area. Lower values mean a more aero position; higher values mean a more upright position."
            value={settings.cda}
            options={CDA_OPTIONS}
            onChange={value => update("cda", value)}
          />
          <SpeedSelectInput
            label="Tire/road"
            help="Crr: rolling resistance coefficient. Lower values mean fast tires and smooth asphalt; higher values mean rough roads or gravel."
            value={settings.crr}
            options={CRR_OPTIONS}
            onChange={value => update("crr", value)}
          />
        </div>
      )}
    </div>
  );
}

function SpeedNumberInput({
  label,
  help,
  value,
  suffix,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  help: string;
  value: number;
  suffix: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState(() => formatSpeedInputValue(value, step));
  useEffect(() => {
    setDraft(formatSpeedInputValue(value, step));
  }, [step, value]);

  return (
    <div>
      <InputLabelWithHelp id={inputId} label={label} help={help} />
      <div className="relative">
        <Input
          id={inputId}
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={event => {
            const next = event.currentTarget.value;
            setDraft(next);
            if (next !== "" && Number.isFinite(Number(next))) onChange(Number(next));
          }}
          onBlur={() => {
            const next = Number(draft);
            if (!Number.isFinite(next)) {
              setDraft(formatSpeedInputValue(value, step));
              return;
            }
            const clamped = clamp(next, min, max);
            if (!Object.is(clamped, value)) onChange(clamped);
            setDraft(formatSpeedInputValue(clamped, step));
          }}
          className={`h-8 ${suffix ? "pr-12" : "pr-2"} font-mono text-xs tabular-nums`}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function SpeedSelectInput({
  label,
  help,
  value,
  options,
  onChange,
}: {
  label: string;
  help: string;
  value: number;
  options: readonly { label: string; value: number }[];
  onChange: (value: number) => void;
}) {
  const selectId = useId();
  const labelId = `${selectId}-label`;

  return (
    <div>
      <InputLabelWithHelp id={selectId} labelId={labelId} label={label} help={help} />
      <Select value={String(value)} onValueChange={next => onChange(Number(next))}>
        <SelectTrigger id={selectId} aria-labelledby={labelId} size="sm" className="h-8 w-full font-mono text-xs tabular-nums">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {options.map(option => (
            <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function InputLabelWithHelp({ id, labelId, label, help }: { id: string; labelId?: string; label: string; help: string }) {
  return (
    <div className="mb-1 flex items-center gap-1.5">
      <Label id={labelId} htmlFor={id} className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</Label>
      <HelpIconButton label={label} help={help} size="sm" />
    </div>
  );
}

function formatSpeedInputValue(value: number, step: number) {
  return String(Number.isInteger(step) ? Math.round(value) : Number(value.toFixed(step < 0.001 ? 4 : 2)));
}

function HelpTooltip({ content, children }: { content: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-64 text-xs leading-snug">{content}</TooltipContent>
    </Tooltip>
  );
}

function SectionTitle({ title, help }: { title: string; help: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-foreground">
        <span className="h-3 w-1 rounded-full bg-primary" aria-hidden="true" />
        {title}
      </div>
      <HelpIconButton label={title} help={help} />
    </div>
  );
}

function HelpIconButton({ label, help, size = "default" }: { label: string; help: string; size?: "default" | "sm" }) {
  return (
    <HelpTooltip content={help}>
      <button
        type="button"
        aria-label={`Help for ${label}`}
        className={`grid place-items-center rounded-full border font-bold leading-none text-muted-foreground hover:bg-muted ${size === "sm" ? "size-3.5 text-[9px]" : "size-4 text-[10px]"}`}
      >
        ?
      </button>
    </HelpTooltip>
  );
}

function SlopeLegend() {
  const bounds = SLOPE_CLASSES.slice(0, -1).map(slopeClass => slopeClass.maxSlope);
  return (
    <div className="ml-auto hidden min-w-0 items-center justify-end gap-2 sm:flex">
      <HelpTooltip content="Slope colors group each part of the route from downhill green to steep climb dark red. Values are based on GPX elevation data.">
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Slope</span>
      </HelpTooltip>
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

function Dropzone({ onFile }: { onFile: (file: File | undefined, source: GpxUploadSource) => void }) {
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
          onFile(event.dataTransfer.files?.[0], "dropzone");
        }}
        className={`flex w-full max-w-xl cursor-pointer flex-col items-center gap-5 border-2 border-dashed p-6 text-center transition-colors sm:p-12 ${drag ? "border-primary bg-muted" : "border-border bg-background hover:bg-muted/50"}`}
      >
        <div className="grid size-14 place-items-center border bg-muted">
          <Upload className="size-6 text-muted-foreground" />
        </div>
        <div>
          <div className="text-base font-semibold">Drop a GPX file here</div>
          <div className="mt-1 text-sm text-muted-foreground">or click to browse — split a route into smaller GPX files</div>
        </div>
        <div className="grid max-w-md gap-2 text-left text-xs text-muted-foreground sm:grid-cols-3">
          <div><span className="font-semibold text-foreground">1. Upload</span><br />Choose a GPX track from your device.</div>
          <div><span className="font-semibold text-foreground">2. Split</span><br />Click the map or elevation profile to add cut points.</div>
          <div><span className="font-semibold text-foreground">3. Export</span><br />Download one GPX per segment, or the unchanged route.</div>
        </div>
        <div className="flex flex-wrap justify-center gap-2 text-[11px] text-muted-foreground">
          <span className={HINT_CHIP_CLASS}>Files stay in your browser</span>
          <span className={HINT_CHIP_CLASS}>Last route is restored locally</span>
          <span className={HINT_CHIP_CLASS}>Use Forget route to clear it</span>
        </div>
        <input type="file" accept={GPX_ACCEPT} className="sr-only" onChange={event => onFile(event.currentTarget.files?.[0], "dropzone")} />
      </label>
    </div>
  );
}

function RouteMap({
  route,
  splits,
  hoverIndex,
  showWaypoints,
  activeWaypointIndex,
  activeSegment,
  onHover,
  onToggleSplit,
  onSelectWaypoint,
  onVisibleRange,
}: {
  route: RouteData | null;
  splits: number[];
  hoverIndex: number | null;
  showWaypoints: boolean;
  activeWaypointIndex: number | null;
  activeSegment: Segment | null;
  onHover: (index: number | null) => void;
  onToggleSplit: (index: number) => void;
  onSelectWaypoint: (index: number | null) => void;
  onVisibleRange: (range: DistanceRange | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const waypointPopupRef = useRef<maplibregl.Popup | null>(null);
  const rafRef = useRef<number | null>(null);
  const routeRef = useRef<RouteData | null>(null);
  const onHoverRef = useRef(onHover);
  const onToggleSplitRef = useRef(onToggleSplit);
  const onSelectWaypointRef = useRef(onSelectWaypoint);
  const onVisibleRangeRef = useRef(onVisibleRange);
  const routeLineData = useMemo(() => (route ? lineData(route) : null), [route]);
  const activeSegmentLineData = useMemo(
    () => (route && activeSegment ? segmentLineData(route, activeSegment) : emptyLine().data),
    [route, activeSegment],
  );
  const splitPointData = useMemo(() => (route ? splitPointDataForRoute(route, splits) : emptyPoints().data), [route, splits]);
  const waypointPointData = useMemo(() => (route && showWaypoints ? waypointData(route, activeWaypointIndex) : emptyPoints().data), [activeWaypointIndex, route, showWaypoints]);
  const hoverPointData = useMemo(
    () => (route ? pointData(route, hoverIndex === null ? [] : [hoverIndex]) : emptyPoints().data),
    [route, hoverIndex],
  );

  routeRef.current = route;
  onHoverRef.current = onHover;
  onToggleSplitRef.current = onToggleSplit;
  onSelectWaypointRef.current = onSelectWaypoint;
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
      map.addSource("waypoints", emptyPoints());
      map.addSource("splits", emptyPoints());
      map.addSource("hover", emptyPoints());
      const routeColor = cssColor("--primary", "#0072bb");
      const activeColor = cssColor("--ring", "#1e91d6");
      const backgroundColor = cssColor("--background", "#fff");
      const splitColor = cssColor("--destructive", "#e18335");
      const waypointColor = cssColor("--accent", "#8fc93a");
      const splitMarkerImage = mapSplitMarkerImage(splitColor, backgroundColor);
      if (splitMarkerImage && !map.hasImage("split-marker")) {
        map.addImage("split-marker", splitMarkerImage);
      }
      map.addLayer({ id: "route-line", type: "line", source: "route", paint: { "line-color": routeColor, "line-width": 4 } });
      map.addLayer({ id: "active-segment-line", type: "line", source: "active-segment", paint: { "line-color": activeColor, "line-width": 7, "line-opacity": 0.9 } });
      map.addLayer({ id: "route-hit", type: "line", source: "route", paint: { "line-color": "#000", "line-opacity": 0.01, "line-width": 28 } });
      map.addLayer({
        id: "waypoint-points",
        type: "circle",
        source: "waypoints",
        paint: {
          "circle-radius": ["case", ["boolean", ["get", "selected"], false], 7, 5],
          "circle-color": waypointColor,
          "circle-stroke-width": ["case", ["boolean", ["get", "selected"], false], 3, 2],
          "circle-stroke-color": backgroundColor,
        },
      });
      map.addLayer({
        id: "waypoint-labels",
        type: "symbol",
        source: "waypoints",
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Regular"],
          "text-size": 12,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
          "text-allow-overlap": false,
          "text-ignore-placement": false,
        },
        paint: { "text-color": routeColor, "text-halo-color": backgroundColor, "text-halo-width": 1.5 },
      });
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
        const waypointIndex = waypointIndexAtPoint(map, event.point);
        if (waypointIndex !== null) {
          onSelectWaypointRef.current(waypointIndex);
          return;
        }
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
      map.on("mouseenter", "waypoint-points", pointer);
      map.on("mouseenter", "waypoint-labels", pointer);
      map.on("mouseenter", "split-points", pointer);
      map.on("mouseenter", "hover-point", crosshair);
      map.on("mouseleave", "route-hit", leave);
      map.on("mouseleave", "route-hit", resetPointer);
      map.on("mouseleave", "waypoint-points", resetPointer);
      map.on("mouseleave", "waypoint-labels", resetPointer);
      map.on("mouseleave", "split-points", resetPointer);
      map.on("mouseleave", "hover-point", resetPointer);
    });
    mapRef.current = map;
    return () => {
      waypointPopupRef.current?.remove();
      waypointPopupRef.current = null;
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
      (map.getSource("waypoints") as GeoJSONSource | undefined)?.setData(waypointPointData);
    };
    map.getSource("waypoints") ? update() : map.once("load", update);
  }, [route, waypointPointData]);

  useEffect(() => {
    const map = mapRef.current;
    const existingPopup = waypointPopupRef.current;
    waypointPopupRef.current = null;
    existingPopup?.remove();
    if (!map || !route || !showWaypoints || activeWaypointIndex === null) return;

    const waypoint = route.waypoints.find(item => item.index === activeWaypointIndex);
    if (!waypoint) return;

    const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 14 })
      .setLngLat([waypoint.lon, waypoint.lat])
      .setDOMContent(waypointPopupElement(route, waypoint))
      .addTo(map);
    popup.on("close", () => {
      if (waypointPopupRef.current === popup) onSelectWaypointRef.current(null);
    });
    waypointPopupRef.current = popup;
  }, [activeWaypointIndex, route, showWaypoints]);

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
  segments,
  splits,
  hoverIndex,
  speedSettings,
  showWaypoints,
  activeWaypointIndex,
  activeSegment,
  focusRange,
  onHover,
  onToggleSplit,
  onSelectWaypoint,
}: {
  route: RouteData | null;
  segments: Segment[];
  splits: number[];
  hoverIndex: number | null;
  speedSettings: SpeedModelSettings | null;
  showWaypoints: boolean;
  activeWaypointIndex: number | null;
  activeSegment: Segment | null;
  focusRange: DistanceRange | null;
  onHover: (index: number | null) => void;
  onToggleSplit: (index: number) => void;
  onSelectWaypoint: (index: number | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const climbCacheRef = useRef<{ points: RouteData["points"]; values: Map<string, number> }>({ points: [], values: new Map() });
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
  const hoverSegment = hover ? segments.find(segment => hover.index >= segment.start && hover.index <= segment.end) ?? null : null;
  const hoverSegmentDistance = hover && hoverSegment ? hover.distance - hoverSegment.startDistance : null;
  const hoverClimb = useMemo(() => {
    if (!hover || !hoverSegment) return null;
    if (climbCacheRef.current.points !== points) climbCacheRef.current = { points, values: new Map() };

    const cacheKey = `${hoverSegment.start}:${hover.index}`;
    const cached = climbCacheRef.current.values.get(cacheKey);
    if (cached !== undefined) return cached;

    const ascent = calculateElevationChange(points.slice(hoverSegment.start, hover.index + 1)).ascent;
    climbCacheRef.current.values.set(cacheKey, ascent);
    return ascent;
  }, [hover, hoverSegment, points]);
  const hoverSlope = hover ? slopeDetailAtDistance(visiblePoints, profileSlopeSegments, hover.distance) : null;
  const trackTimes = useMemo(() => speedSettings ? calculateCumulativeSpeedTimes(points, speedSettings) : [], [points, speedSettings]);
  const segmentTimes = useMemo(
    () => speedSettings ? new Map(segments.map(segment => [segment.id, calculateCumulativeSpeedTimes(points, speedSettings, segment.start, segment.end)])) : new Map<number, number[]>(),
    [points, segments, speedSettings],
  );
  const hoverTime = hover && speedSettings ? trackTimes[hover.index] : null;
  const hoverSegmentTime = hover && hoverSegment && speedSettings ? segmentTimes.get(hoverSegment.id)?.[hover.index] ?? null : null;
  const hoverSlopeColor = getSlopeColor(hoverSlope?.slope ?? 0);
  const hoverSlopeLabel = getSlopeLabel(hoverSlope?.slope ?? 0);
  const hoverSlopeName = getSlopeName(hoverSlope?.slope ?? 0);
  const visibleWaypoints = useMemo(() => {
    if (!route || !showWaypoints) return [];
    return route.waypoints
      .map(waypoint => {
        const point = points[waypoint.nearestPointIndex];
        if (!point || point.distance < profileRange.start || point.distance > profileRange.end) return null;
        return {
          key: waypoint.index,
          label: shortWaypointLabel(waypointName(waypoint)),
          fullLabel: waypointName(waypoint),
          waypoint,
          distance: point.distance,
          ele: waypoint.ele ?? point.ele,
        };
      })
      .filter(item => item !== null);
  }, [points, profileRange, route, showWaypoints]);
  const hoverX = hover ? x(hover.distance) : 0;
  const hoverY = hover ? y(hover.ele) : 0;
  const hoverLabelWidth = 220;
  const trackSectionHeight = speedSettings ? 57 : 44;
  const hoverSectionHeight = 44;
  const segmentSectionHeight = speedSettings && hoverSegment ? 57 : hoverSectionHeight;
  const hoverSectionGap = 4;
  const hoverLabelHeight = (hoverSegment ? 152 : 104) + (speedSettings ? (hoverSegment ? 26 : 13) : 0);
  const hoverLabelX = Math.min(width - hoverLabelWidth - 8, Math.max(padLeft + 8, hoverX + 10));
  const preferredHoverLabelY = hoverY < height / 2 ? hoverY + 14 : hoverY - hoverLabelHeight - 8;
  const hoverLabelMaxY = Math.max(padTop + 6, height - hoverLabelHeight - 6);
  const hoverLabelY = Math.min(hoverLabelMaxY, Math.max(padTop + 6, preferredHoverLabelY));
  const hoverLabelLeft = hoverLabelX + 12;
  const hoverValueRight = hoverLabelX + hoverLabelWidth - 12;
  const trackSectionY = hoverLabelY + 8;
  const segmentSectionY = trackSectionY + trackSectionHeight + hoverSectionGap;
  const slopeSectionY = hoverSegment ? segmentSectionY + segmentSectionHeight + hoverSectionGap : segmentSectionY;
  const laidOutWaypoints = useMemo(() => {
    const boxes: Array<{ left: number; right: number; top: number; bottom: number }> = [];

    return visibleWaypoints.map(waypoint => {
      const waypointX = x(waypoint.distance);
      const waypointY = y(waypoint.ele);
      const labelWidth = Math.min(160, Math.max(28, waypoint.label.length * 6.2));
      const labelHeight = 12;
      const baseLabelX = Math.min(plotRight - labelWidth, Math.max(padLeft + 4, waypointX + 8));

      for (let row = 0; row < 4; row++) {
        const labelY = Math.max(padTop + labelHeight, waypointY - 10 - row * 14);
        const box = {
          left: baseLabelX - 2,
          right: baseLabelX + labelWidth + 2,
          top: labelY - labelHeight,
          bottom: labelY + 2,
        };
        if (!boxes.some(existing => boxesOverlap(existing, box))) {
          boxes.push(box);
          return { ...waypoint, waypointX, waypointY, labelX: baseLabelX, labelY, labelWidth, showLabel: true };
        }
      }

      return { ...waypoint, waypointX, waypointY, labelX: baseLabelX, labelY: waypointY - 10, labelWidth, showLabel: false };
    });
  }, [padLeft, padTop, plotRight, visibleWaypoints, x, y]);
  function svgPointFromEvent(event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * width,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * height,
    };
  }

  function indexFromEvent(event: React.PointerEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>) {
    if (!route) return null;
    const { x: svgX } = svgPointFromEvent(event);
    const plotX = Math.max(padLeft, Math.min(plotRight, svgX));
    const ratio = (plotX - padLeft) / plotWidth;
    const distance = profileRange.start + ratio * (profileRange.end - profileRange.start);
    return nearestPoint(route.points, distance / 1000);
  }

  function waypointIndexFromEvent(event: React.MouseEvent<SVGSVGElement>) {
    const point = svgPointFromEvent(event);
    for (const waypoint of laidOutWaypoints) {
      const markerHit = (point.x - waypoint.waypointX) ** 2 + (point.y - waypoint.waypointY) ** 2 <= 12 ** 2;
      const waypointBandHit = Math.abs(point.x - waypoint.waypointX) <= 18 && point.y >= padTop && point.y <= plotBottom + 18;
      const labelHit = waypoint.showLabel &&
        point.x >= waypoint.labelX - 4 &&
        point.x <= waypoint.labelX + waypoint.labelWidth + 4 &&
        point.y >= waypoint.labelY - 14 &&
        point.y <= waypoint.labelY + 5;
      if (markerHit || waypointBandHit || labelHit) return waypoint.key;
    }
    return null;
  }

  function focusIndex(step: number) {
    if (!route) return;
    const current = hoverIndex ?? 0;
    onHover(Math.max(0, Math.min(route.points.length - 1, current + step)));
  }

  function renderTooltipMetric(y: number, label: string, value: ReactNode) {
    return (
      <>
        <text x={hoverLabelLeft} y={y} className="fill-muted-foreground font-mono text-[9px] uppercase">
          {label}
        </text>
        <text x={hoverValueRight} y={y} textAnchor="end" className="fill-foreground font-mono text-[12px] font-bold">
          {value}
        </text>
      </>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full min-w-0 overflow-hidden">
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="block h-full w-full touch-none cursor-crosshair"
      role="application"
      tabIndex={0}
      aria-label="Elevation profile. Use left and right arrows to inspect points, Enter to add or remove a split, and Tab to reach waypoint markers."
      onPointerMove={event => onHover(indexFromEvent(event))}
      onPointerLeave={() => onHover(null)}
      onClick={event => {
        const waypointIndex = waypointIndexFromEvent(event);
        if (waypointIndex !== null) {
          onSelectWaypoint(waypointIndex);
          return;
        }
        const index = indexFromEvent(event);
        if (index !== null) onToggleSplit(index);
      }}
      onKeyDown={event => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          focusIndex(event.shiftKey ? -10 : -1);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          focusIndex(event.shiftKey ? 10 : 1);
        } else if ((event.key === "Enter" || event.key === " ") && hoverIndex !== null) {
          event.preventDefault();
          onToggleSplit(hoverIndex);
        }
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
      {laidOutWaypoints.map(waypoint => {
        const active = waypoint.key === activeWaypointIndex;
        return (
          <g key={waypoint.key} className="pointer-events-none">
            <title>{waypoint.fullLabel}</title>
            <line x1={waypoint.waypointX} x2={waypoint.waypointX} y1={waypoint.waypointY} y2={plotBottom} className="stroke-accent" strokeDasharray="2 3" strokeWidth="1" opacity="0.7" vectorEffect="non-scaling-stroke" />
            <circle cx={waypoint.waypointX} cy={waypoint.waypointY} r={active ? "7" : "5"} className="fill-accent stroke-background" strokeWidth={active ? "3" : "2"} vectorEffect="non-scaling-stroke" />
            {waypoint.showLabel && (
              <text
                x={waypoint.labelX}
                y={waypoint.labelY}
                className="fill-primary stroke-background font-mono text-[10px] font-bold"
                strokeWidth="3"
                paintOrder="stroke fill"
                vectorEffect="non-scaling-stroke"
              >
                {waypoint.label}
              </text>
            )}
          </g>
        );
      })}
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
            <rect x={hoverLabelX} y={hoverLabelY} width={hoverLabelWidth} height={hoverLabelHeight} rx="3" className="fill-background stroke-border" vectorEffect="non-scaling-stroke" />
            <rect x={hoverLabelX + 6} y={trackSectionY} width={hoverLabelWidth - 12} height={trackSectionHeight} rx="2" className="fill-muted/35 stroke-border" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
            <text x={hoverLabelLeft} y={trackSectionY + 12} className="fill-muted-foreground font-mono text-[9px] font-bold uppercase">
              Track point
            </text>
            <text x={hoverLabelLeft} y={trackSectionY + 27} className="fill-muted-foreground font-mono text-[9px] uppercase">
              Distance
            </text>
            <text x={hoverValueRight} y={trackSectionY + 27} textAnchor="end" className="fill-foreground font-mono text-[12px] font-bold">
              {formatDistance(hover.distance)}
            </text>
            <text x={hoverLabelLeft} y={trackSectionY + 40} className="fill-muted-foreground font-mono text-[9px] uppercase">
              Elevation
            </text>
            <text x={hoverValueRight} y={trackSectionY + 40} textAnchor="end" className="fill-foreground font-mono text-[12px] font-bold">
              {formatElevation(hover.ele)}
            </text>
            {speedSettings && (
              renderTooltipMetric(trackSectionY + 53, "Est. time", hoverTime === null ? "—" : formatMovingTime(hoverTime))
            )}
            {hoverSegment && (
              <>
                <rect x={hoverLabelX + 6} y={segmentSectionY} width={hoverLabelWidth - 12} height={segmentSectionHeight} rx="2" className="fill-muted/35 stroke-border" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
                <text x={hoverLabelLeft} y={segmentSectionY + 12} className="fill-muted-foreground font-mono text-[9px] font-bold uppercase">
                  {hoverSegment.name}
                </text>
                <text x={hoverLabelLeft} y={segmentSectionY + 27} className="fill-muted-foreground font-mono text-[9px] uppercase">
                  Distance
                </text>
                <text x={hoverValueRight} y={segmentSectionY + 27} textAnchor="end" className="fill-foreground font-mono text-[12px] font-bold">
                  {hoverSegmentDistance === null ? "—" : formatDistance(hoverSegmentDistance)}
                </text>
                <text x={hoverLabelLeft} y={segmentSectionY + 40} className="fill-muted-foreground font-mono text-[9px] uppercase">
                  Climb
                </text>
                <text x={hoverValueRight} y={segmentSectionY + 40} textAnchor="end" className="fill-foreground font-mono text-[12px] font-bold">
                  {hoverClimb === null ? "—" : formatElevation(hoverClimb)}
                </text>
                {speedSettings && (
                  renderTooltipMetric(segmentSectionY + 53, "Est. time", hoverSegmentTime === null ? "—" : formatMovingTime(hoverSegmentTime))
                )}
              </>
            )}
            <rect x={hoverLabelX + 6} y={slopeSectionY} width={hoverLabelWidth - 12} height={hoverSectionHeight} rx="2" className="fill-muted/35 stroke-border" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
            <rect x={hoverLabelLeft} y={slopeSectionY + 6} width="8" height="8" fill={hoverSlopeColor} stroke="currentColor" className="text-border" vectorEffect="non-scaling-stroke" />
            <text x={hoverLabelLeft + 14} y={slopeSectionY + 12} className="fill-muted-foreground font-mono text-[9px] font-bold uppercase">
              {hoverSlopeName}
            </text>
            <text x={hoverValueRight} y={slopeSectionY + 12} textAnchor="end" className="fill-foreground font-mono text-[10px] font-bold">
              {hoverSlopeLabel}
            </text>
            <text x={hoverLabelLeft} y={slopeSectionY + 27} className="fill-muted-foreground font-mono text-[9px] uppercase">
              Distance
            </text>
            <text x={hoverValueRight} y={slopeSectionY + 27} textAnchor="end" className="fill-foreground font-mono text-[12px] font-bold">
              {formatDistance(hoverSlope?.distance ?? 0)}
            </text>
            <text x={hoverLabelLeft} y={slopeSectionY + 40} className="fill-muted-foreground font-mono text-[9px] uppercase">
              Avg slope
            </text>
            <text x={hoverValueRight} y={slopeSectionY + 40} textAnchor="end" className="fill-foreground font-mono text-[12px] font-bold">
              {formatSlope(hoverSlope?.slope ?? 0)}
            </text>
          </g>
        </>
      )}
      <text x={padLeft} y={height - 7} textAnchor="start" className="fill-muted-foreground font-mono text-[10px]">{formatDistance(profileRange.start)}</text>
      <text x={padLeft + plotWidth / 2} y={height - 7} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px]">{formatDistance((profileRange.start + profileRange.end) / 2)}</text>
      <text x={plotRight} y={height - 7} textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">{formatDistance(profileRange.end)}</text>
    </svg>
    {laidOutWaypoints.map(waypoint => (
      <button
        key={waypoint.key}
        type="button"
        className="absolute z-10 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border border-transparent bg-transparent outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        style={{ left: `${(waypoint.waypointX / width) * 100}%`, top: `${(waypoint.waypointY / height) * 100}%` }}
        onClick={() => onSelectWaypoint(waypoint.key)}
        aria-label={`Show waypoint details for ${waypoint.fullLabel}`}
        aria-pressed={waypoint.key === activeWaypointIndex}
        title={waypoint.fullLabel}
      />
    ))}
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

function boxesOverlap(
  first: { left: number; right: number; top: number; bottom: number },
  second: { left: number; right: number; top: number; bottom: number },
) {
  return first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;
}

function SegmentRow({
  segment,
  speed,
  distanceBalance,
  climbBalance,
  active,
  onSelect,
  onExport,
}: {
  segment: Segment;
  speed?: SpeedEstimate;
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
              <SegmentMetric
                label="Distance"
                value={formatDistance(segment.distance)}
                progress={distanceBalance}
                help="Length of this segment. The blue fill compares it with the longest segment."
                strong
              />
              {speed && (
                <>
                  <SegmentMetric
                    label="Est. time"
                    value={formatMovingTime(speed.movingTimeSeconds)}
                    help="Estimated moving time for this segment with the custom speed model."
                  />
                  <SegmentMetric
                    label="Est. speed"
                    value={formatSpeed(speed.averageSpeedMps)}
                    help="Estimated average moving speed for this segment."
                  />
                </>
              )}
              <SegmentMetric
                label="Climb"
                value={`↑ ${formatElevation(segment.ascent)}`}
                progress={climbBalance}
                help="Total ascent inside this segment, calculated from GPX elevation data. The blue fill compares it with the biggest climb."
              />
              <SegmentMetric label="Drop" value={`↓ ${formatElevation(segment.descent)}`} help="Total descent inside this segment, calculated from GPX elevation data." />
            </div>

            <UphillSummary percent={uphillPercent} distance={uphillDistance} />

            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <SegmentMetric label="Lowest" value={formatElevation(segment.minEle)} help="Lowest elevation point found in this segment. Shows — if the GPX has no elevation data." />
              <SegmentMetric label="Highest" value={formatElevation(segment.maxEle)} help="Highest elevation point found in this segment. Shows — if the GPX has no elevation data." />
            </div>

            <div className="mt-2 overflow-hidden rounded-[2px] border bg-muted" aria-label="Slope distribution. Hover each color for distance and share.">
              <div className="flex h-6 w-full">
                {segment.slopeDistances.filter(item => item.distance > 0).map(item => {
                  const percent = segment.distance > 0 ? (item.distance / segment.distance) * 100 : 0;
                  const percentLabel = formatPercent(percent);
                  const distanceLabel = formatDistance(item.distance);
                  return (
                    <Tooltip key={item.label} delayDuration={0}>
                      <TooltipTrigger asChild>
                        <div
                          className="grid min-w-0 place-items-center overflow-hidden font-mono text-[10px] font-bold leading-none text-black/70 tabular-nums"
                          style={{ flexBasis: `${percent}%`, backgroundColor: item.color }}
                          aria-label={`${item.name} ${item.label}: ${percentLabel}, ${distanceLabel}`}
                        >
                          {percent >= 10 ? percentLabel : null}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent hideArrow className="border bg-background p-1 text-foreground shadow-md">
                        <div className="w-40 rounded-[2px] border bg-muted/35 px-2 py-1.5 font-mono tabular-nums">
                          <div className="mb-1.5 flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="size-2.5 shrink-0 rounded-[1px] border border-border" style={{ backgroundColor: item.color }} />
                              <span className="min-w-0 text-[9px] font-bold uppercase leading-tight text-muted-foreground">{item.name}</span>
                            </div>
                            <span className="shrink-0 text-[10px] font-bold leading-none">{item.label}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5 border-t pt-1.5">
                            <div>
                              <div className="text-[9px] uppercase text-muted-foreground">Distance</div>
                              <div className="text-[12px] font-bold leading-tight">{distanceLabel}</div>
                            </div>
                            <div>
                              <div className="text-[9px] uppercase text-muted-foreground">Share</div>
                              <div className="text-[12px] font-bold leading-tight">{percentLabel}</div>
                            </div>
                          </div>
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
      <HelpTooltip content="Download only this segment as a GPX file.">
        <Button
          size="icon-sm"
          variant="ghost"
          className="absolute right-2.5 top-2.5 opacity-70"
          onClick={onExport}
        >
          <Download />
        </Button>
      </HelpTooltip>
    </div>
  );
}

function SegmentMetric({
  label,
  value,
  help,
  progress,
  strong = false,
}: {
  label: string;
  value: string;
  help: string;
  progress?: number;
  strong?: boolean;
}) {
  return (
    <HelpTooltip content={help}>
      <div className="relative overflow-hidden rounded-[2px] border bg-background px-2 py-1.5">
        {progress !== undefined && (
          <div className="absolute inset-y-0 left-0 bg-primary/15" style={{ width: `${Math.max(0, Math.min(progress, 1)) * 100}%` }} />
        )}
        <div className="relative text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`relative mt-0.5 font-mono text-xs tabular-nums ${strong ? "font-bold text-foreground" : "text-foreground/85"}`}>{value}</div>
      </div>
    </HelpTooltip>
  );
}

function UphillSummary({ percent, distance }: { percent: number; distance: number }) {
  return (
    <HelpTooltip content="Share and distance of this segment where the calculated slope is steeper than +1%.">
      <div className="mt-1.5 grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-[2px] border bg-background px-2 py-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Uphill &gt;1%</div>
        <div className="h-1.5 overflow-hidden rounded-[1px] bg-muted">
          <div className="h-full bg-chart-4/70" style={{ width: `${Math.max(0, Math.min(percent, 100))}%` }} />
        </div>
        <div className="font-mono text-[11px] font-semibold tabular-nums">
          {formatPercent(percent)} · {formatDistance(distance)}
        </div>
      </div>
    </HelpTooltip>
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

function waypointName(waypoint: Waypoint) {
  return waypoint.name || `Waypoint ${waypoint.index + 1}`;
}

function shortWaypointLabel(label: string) {
  return label.length > 26 ? `${label.slice(0, 23)}…` : label;
}

function formatWaypointTime(time: string | null) {
  if (!time) return "—";
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? time : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function waypointPopupElement(route: RouteData, waypoint: Waypoint) {
  const point = route.points[waypoint.nearestPointIndex];
  const element = document.createElement("div");
  element.className = "min-w-48 max-w-64 text-xs";

  const title = document.createElement("div");
  title.className = "mb-1 font-semibold";
  title.textContent = waypointName(waypoint);
  element.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "font-mono text-[11px] text-muted-foreground";
  meta.textContent = `${point ? formatDistance(point.distance) : "—"} · ${formatElevation(waypoint.ele ?? point?.ele ?? null)}`;
  element.appendChild(meta);

  const time = formatWaypointTime(waypoint.time);
  if (time !== "—") {
    const timeElement = document.createElement("div");
    timeElement.className = "mt-1 text-[11px] text-muted-foreground";
    timeElement.textContent = time;
    element.appendChild(timeElement);
  }

  if (waypoint.desc) {
    const description = document.createElement("p");
    description.className = "mt-2 leading-snug";
    description.textContent = waypoint.desc;
    element.appendChild(description);
  }

  return element;
}

function waypointData(route: RouteData, activeWaypointIndex: number | null): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: route.waypoints.map(waypoint => ({
      type: "Feature",
      properties: {
        index: waypoint.index,
        label: waypoint.name ? shortWaypointLabel(waypoint.name) : "",
        selected: waypoint.index === activeWaypointIndex,
      },
      geometry: { type: "Point", coordinates: [waypoint.lon, waypoint.lat] },
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

function markerIndexAtPoint(map: MapLibreMap, point: maplibregl.PointLike) {
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

function waypointIndexAtPoint(map: MapLibreMap, point: maplibregl.PointLike) {
  const [x, y] = Array.isArray(point) ? point : [point.x, point.y];
  const features = map.queryRenderedFeatures(
    [
      [x - 10, y - 10],
      [x + 10, y + 10],
    ],
    { layers: ["waypoint-points", "waypoint-labels"] },
  );
  const index = Number(features[0]?.properties?.index);
  return Number.isInteger(index) ? index : null;
}

function nearestScreenPoint(map: MapLibreMap, route: RouteData, clickPoint: maplibregl.PointLike, maxPixels: number) {
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

function visibleDistanceRange(map: MapLibreMap, route: RouteData): DistanceRange | null {
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
