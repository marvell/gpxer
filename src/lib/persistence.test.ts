import { afterEach, expect, test } from "bun:test";
import {
  clearSavedRouteState,
  isSavedRouteState,
  loadSavedRouteState,
  sanitizeActiveSegmentId,
  sanitizeSplits,
  saveRouteState,
  type SavedRouteState,
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
  };

  expect(await saveRouteState(state)).toBe(true);
  expect(await loadSavedRouteState()).toEqual(state);
});

test("rejects unsupported or corrupt route state", () => {
  expect(isSavedRouteState({ version: 2, gpxText: "<gpx></gpx>", fileName: "route.gpx", splits: [], activeSegmentId: null })).toBe(false);
  expect(isSavedRouteState({ version: 1, gpxText: "", fileName: "route.gpx", splits: [], activeSegmentId: null })).toBe(false);
  expect(isSavedRouteState({ version: 1, gpxText: "<gpx></gpx>", fileName: "route.gpx", splits: [1.5], activeSegmentId: null })).toBe(false);
  expect(isSavedRouteState({ version: 1, gpxText: "<gpx></gpx>", fileName: "route.gpx", splits: [], activeSegmentId: "2" })).toBe(false);
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

test("handles unavailable IndexedDB without crashing", async () => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: undefined });

  expect(await loadSavedRouteState()).toBeNull();
  expect(await saveRouteState({ version: 1, gpxText: "<gpx></gpx>", fileName: "route.gpx", splits: [], activeSegmentId: null })).toBe(false);
  expect(await clearSavedRouteState()).toBe(false);
});

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
