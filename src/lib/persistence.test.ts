import { afterEach, expect, test } from "bun:test";
import { DEFAULT_SPEED_MODEL_SETTINGS, SPEED_MODEL_LIMITS } from "./gpx";
import {
  clearSavedRouteState,
  isSavedRouteState,
  isSavedSpeedSettingsState,
  loadSavedRouteState,
  loadSavedSpeedSettingsState,
  sanitizeActiveSegmentId,
  sanitizeSpeedSettings,
  sanitizeSplits,
  saveRouteState,
  saveSpeedSettingsState,
  type SavedRouteState,
  type SavedSpeedSettingsState,
} from "./persistence";

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
});

test("saves and loads a valid route state", async () => {
  installFakeIndexedDb();
  const state: SavedRouteState = {
    version: 1,
    gpxText: "<gpx></gpx>",
    fileName: "route.gpx",
    splits: [3, 8],
    activeSegmentId: 2,
    showWaypoints: false,
  };

  expect(await saveRouteState(state)).toBe(true);
  expect(await loadSavedRouteState()).toEqual(state);
});

test("rejects unsupported or corrupt route state", () => {
  expect(isSavedRouteState({ version: 2, gpxText: "<gpx></gpx>", fileName: "route.gpx", splits: [], activeSegmentId: null, showWaypoints: true })).toBe(false);
  expect(isSavedRouteState({ version: 1, gpxText: "", fileName: "route.gpx", splits: [], activeSegmentId: null, showWaypoints: true })).toBe(false);
  expect(isSavedRouteState({ version: 1, gpxText: "<gpx></gpx>", fileName: "route.gpx", splits: [1.5], activeSegmentId: null, showWaypoints: true })).toBe(false);
  expect(isSavedRouteState({ version: 1, gpxText: "<gpx></gpx>", fileName: "route.gpx", splits: [], activeSegmentId: "2", showWaypoints: true })).toBe(false);
  expect(isSavedRouteState({ version: 1, gpxText: "<gpx></gpx>", fileName: "route.gpx", splits: [], activeSegmentId: null, showWaypoints: "yes" })).toBe(false);
  expect(isSavedRouteState({ version: 1, gpxText: "<gpx></gpx>", fileName: "route.gpx", splits: [], activeSegmentId: null })).toBe(true);
});

test("clears corrupt route state on load", async () => {
  const data = installFakeIndexedDb();
  data.set("last-route", { key: "last-route", version: 2 });

  expect(await loadSavedRouteState()).toBeNull();
  expect(data.has("last-route")).toBe(false);
});

test("sanitizes split indexes and active segment ids", () => {
  expect(sanitizeSplits([4, 0, 2, 2, 9, -1, 5], 6)).toEqual([2, 4]);
  expect(sanitizeActiveSegmentId(2, 3)).toBe(2);
  expect(sanitizeActiveSegmentId(5, 3)).toBe(1);
  expect(sanitizeActiveSegmentId(null, 3)).toBe(1);
  expect(sanitizeActiveSegmentId(1, 0)).toBeNull();
});

test("saves and loads valid speed settings", () => {
  installFakeLocalStorage();
  const state: SavedSpeedSettingsState = {
    version: 1,
    enabled: true,
    settings: {
      powerWatts: 180,
      massKg: 82,
      cda: 0.32,
      crr: 0.005,
    },
  };

  expect(saveSpeedSettingsState(state)).toBe(true);
  expect(loadSavedSpeedSettingsState()).toEqual(state);
});

test("rejects corrupt speed settings", () => {
  expect(isSavedSpeedSettingsState({ version: 2, enabled: true, settings: DEFAULT_SPEED_MODEL_SETTINGS })).toBe(false);
  expect(isSavedSpeedSettingsState({ version: 1, enabled: "yes", settings: DEFAULT_SPEED_MODEL_SETTINGS })).toBe(false);
  expect(isSavedSpeedSettingsState({ version: 1, enabled: true, settings: { ...DEFAULT_SPEED_MODEL_SETTINGS, powerWatts: Number.NaN } })).toBe(false);
  expect(isSavedSpeedSettingsState({ version: 1, enabled: true, settings: { powerWatts: 100 } })).toBe(false);
});

test("sanitizes speed settings limits", () => {
  expect(sanitizeSpeedSettings({
    powerWatts: 1,
    massKg: 1,
    cda: 1,
    crr: 1,
  })).toEqual({
    powerWatts: SPEED_MODEL_LIMITS.powerWatts.min,
    massKg: SPEED_MODEL_LIMITS.massKg.min,
    cda: SPEED_MODEL_LIMITS.cda.max,
    crr: SPEED_MODEL_LIMITS.crr.max,
  });
});

test("clears corrupt saved speed settings on load", () => {
  const storage = installFakeLocalStorage();
  storage.setItem("gpxer:speed-settings", JSON.stringify({ version: 1, enabled: true, settings: { powerWatts: 100 } }));

  expect(loadSavedSpeedSettingsState()).toBeNull();
  expect(storage.getItem("gpxer:speed-settings")).toBeNull();
});

test("handles unavailable IndexedDB without crashing", async () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });

  expect(await loadSavedRouteState()).toBeNull();
  expect(await saveRouteState({ version: 1, gpxText: "<gpx></gpx>", fileName: "route.gpx", splits: [], activeSegmentId: null, showWaypoints: true })).toBe(false);
  expect(await clearSavedRouteState()).toBe(false);
});

test("handles unavailable localStorage without crashing", () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });

  expect(loadSavedSpeedSettingsState()).toBeNull();
  expect(saveSpeedSettingsState({ version: 1, enabled: true, settings: DEFAULT_SPEED_MODEL_SETTINGS })).toBe(false);
});

function installFakeLocalStorage() {
  const data = new Map<string, string>();
  const storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: key => {
      data.delete(key);
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: storage },
  });

  return storage;
}

function installFakeIndexedDb() {
  const data = new Map<string, unknown>();
  let storeCreated = false;
  const fakeIndexedDb = {
    open() {
      const request = {} as IDBOpenDBRequest & { result: FakeDb };
      queueMicrotask(() => {
        Object.defineProperty(request, "result", {
          configurable: true,
          value: new FakeDb(data, () => storeCreated, () => {
            storeCreated = true;
          }),
        });
        if (!storeCreated) request.onupgradeneeded?.({} as IDBVersionChangeEvent);
        request.onsuccess?.({} as Event);
      });
      return request as IDBOpenDBRequest;
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { indexedDB: fakeIndexedDb },
  });

  return data;
}

class FakeDb {
  objectStoreNames: Pick<DOMStringList, "contains">;

  constructor(
    private data: Map<string, unknown>,
    private hasStore: () => boolean,
    private markStoreCreated: () => void,
  ) {
    this.objectStoreNames = { contains: () => this.hasStore() };
  }

  createObjectStore() {
    this.markStoreCreated();
  }

  transaction() {
    return {
      objectStore: () => ({
        get: (key: string) => fakeRequest(this.data.get(key)),
        put: (value: { key: string }) => {
          this.data.set(value.key, value);
          return fakeRequest(undefined);
        },
        delete: (key: string) => {
          this.data.delete(key);
          return fakeRequest(undefined);
        },
      }),
    };
  }

  close() {}
}

function fakeRequest<T>(result: T) {
  const request = {} as IDBRequest<T>;
  queueMicrotask(() => {
    Object.defineProperty(request, "result", { configurable: true, value: result });
    request.onsuccess?.({} as Event);
  });
  return request as IDBRequest<T>;
}
