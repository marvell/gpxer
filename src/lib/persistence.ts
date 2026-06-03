export type SavedRouteState = {
  version: 1;
  gpxText: string;
  fileName: string;
  splits: number[];
  activeSegmentId: number | null;
};

type RoutePersistenceRecord = {
  version: number;
  gpxText: string;
  fileName: string;
  splits: number[];
  activeSegmentId: number | null;
};

type StoredRouteState = RoutePersistenceRecord & {
  key: typeof ROUTE_STATE_KEY;
};

const DB_NAME = "gpxer";
const STORE_NAME = "route-state";
const ROUTE_STATE_KEY = "last-route";
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
    && (record.activeSegmentId === null || Number.isInteger(record.activeSegmentId));
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
    } satisfies SavedRouteState;
  } catch {
    return null;
  } finally {
    db.close();
  }
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
