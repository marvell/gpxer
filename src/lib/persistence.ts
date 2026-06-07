import { DEFAULT_SPEED_MODEL_SETTINGS, sanitizeSpeedSettings, type SpeedModelSettings } from "./gpx";
export { sanitizeSpeedSettings } from "./gpx";

export type SavedRouteState = {
  version: 1;
  gpxText: string;
  fileName: string;
  splits: number[];
  activeSegmentId: number | null;
  showWaypoints: boolean;
};

export type SavedSpeedSettingsState = {
  version: 1;
  enabled: boolean;
  settings: SpeedModelSettings;
};

type RoutePersistenceRecord = {
  version: number;
  gpxText: string;
  fileName: string;
  splits: number[];
  activeSegmentId: number | null;
  showWaypoints?: boolean;
};

type SpeedSettingsPersistenceRecord = {
  version: number;
  enabled: boolean;
  settings: Partial<SpeedModelSettings>;
};

type StoredRouteState = RoutePersistenceRecord & {
  key: typeof ROUTE_STATE_KEY;
};

const DB_NAME = "gpxer";
const STORE_NAME = "route-state";
const ROUTE_STATE_KEY = "last-route";
const SPEED_SETTINGS_KEY = "gpxer:speed-settings";
const SCHEMA_VERSION = 1;

export function isSavedRouteState(value: unknown): value is SavedRouteState {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<RoutePersistenceRecord>;

  return record.version === SCHEMA_VERSION
    && typeof record.gpxText === "string"
    && record.gpxText.length > 0
    && typeof record.fileName === "string"
    && record.fileName.length > 0
    && Array.isArray(record.splits)
    && record.splits.every(split => Number.isInteger(split))
    && (record.activeSegmentId === null || Number.isInteger(record.activeSegmentId))
    && (record.showWaypoints === undefined || typeof record.showWaypoints === "boolean");
}

export function isSavedSpeedSettingsState(value: unknown): value is SavedSpeedSettingsState {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<SpeedSettingsPersistenceRecord>;
  if (record.version !== SCHEMA_VERSION || typeof record.enabled !== "boolean" || !record.settings || typeof record.settings !== "object") return false;

  return isFiniteNumber(record.settings.powerWatts)
    && isFiniteNumber(record.settings.massKg)
    && isFiniteNumber(record.settings.cda)
    && isFiniteNumber(record.settings.crr);
}

export function sanitizeSplits(splits: number[], pointCount: number) {
  return [...new Set(splits)]
    .filter(split => split > 0 && split < pointCount - 1)
    .sort((a, b) => a - b);
}

export function sanitizeActiveSegmentId(activeSegmentId: number | null, segmentCount: number) {
  if (segmentCount <= 0) return null;
  if (activeSegmentId === null || activeSegmentId < 1 || activeSegmentId > segmentCount) return 1;
  return activeSegmentId;
}

export function loadSavedSpeedSettingsState() {
  const storage = getLocalStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(SPEED_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isSavedSpeedSettingsState(parsed)) {
      storage.removeItem(SPEED_SETTINGS_KEY);
      return null;
    }

    return {
      version: SCHEMA_VERSION,
      enabled: parsed.enabled,
      settings: sanitizeSpeedSettings({
        ...DEFAULT_SPEED_MODEL_SETTINGS,
        ...parsed.settings,
      }),
    } satisfies SavedSpeedSettingsState;
  } catch {
    return null;
  }
}

export function saveSpeedSettingsState(state: SavedSpeedSettingsState) {
  const storage = getLocalStorage();
  if (!storage) return false;

  try {
    storage.setItem(SPEED_SETTINGS_KEY, JSON.stringify({
      version: SCHEMA_VERSION,
      enabled: state.enabled,
      settings: sanitizeSpeedSettings(state.settings),
    }));
    return true;
  } catch {
    return false;
  }
}

export async function loadSavedRouteState() {
  const db = await openRouteStateDb();
  if (!db) return null;

  try {
    const stored = await getStoredRouteState(db);
    if (!stored) return null;
    if (!isSavedRouteState(stored)) {
      await clearSavedRouteState(db);
      return null;
    }
    return {
      version: SCHEMA_VERSION,
      gpxText: stored.gpxText,
      fileName: stored.fileName,
      splits: stored.splits,
      activeSegmentId: stored.activeSegmentId,
      showWaypoints: stored.showWaypoints ?? true,
    } satisfies SavedRouteState;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function getLocalStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export async function saveRouteState(state: SavedRouteState) {
  const db = await openRouteStateDb();
  if (!db) return false;

  try {
    const stored: StoredRouteState = { ...state, key: ROUTE_STATE_KEY };
    await putStoredRouteState(db, stored);
    return true;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

export async function clearSavedRouteState(db?: IDBDatabase) {
  const ownedDb = db ? null : await openRouteStateDb();
  const targetDb = db ?? ownedDb;
  if (!targetDb) return false;

  try {
    await deleteStoredRouteState(targetDb);
    return true;
  } catch {
    return false;
  } finally {
    ownedDb?.close();
  }
}

async function openRouteStateDb() {
  if (typeof window === "undefined" || !window.indexedDB) return null;

  return new Promise<IDBDatabase | null>(resolve => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
    request.onsuccess = () => resolve(request.result);
  });
}

function getStoredRouteState(db: IDBDatabase) {
  return runStoreRequest<StoredRouteState | undefined>(db, "readonly", store => store.get(ROUTE_STATE_KEY));
}

function putStoredRouteState(db: IDBDatabase, state: StoredRouteState) {
  return runStoreRequest<void>(db, "readwrite", store => store.put(state));
}

function deleteStoredRouteState(db: IDBDatabase) {
  return runStoreRequest<void>(db, "readwrite", store => store.delete(ROUTE_STATE_KEY));
}

function runStoreRequest<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest,
) {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as T);
    transaction.onerror = () => reject(transaction.error);
  });
}
