import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TtlCache } from "../ttlCache.js";

describe("TtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for missing keys", () => {
    const cache = new TtlCache<string>({ defaultTtlMs: 1000, maxEntries: 10 });
    expect(cache.get("missing")).toBeNull();
  });

  it("stores and retrieves values", () => {
    const cache = new TtlCache<string>({ defaultTtlMs: 1000, maxEntries: 10 });
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");
  });

  it("expires entries after TTL", () => {
    const cache = new TtlCache<string>({ defaultTtlMs: 1000, maxEntries: 10 });
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");

    vi.advanceTimersByTime(1001);
    expect(cache.get("key")).toBeNull();
  });

  it("supports custom TTL per entry", () => {
    const cache = new TtlCache<string>({ defaultTtlMs: 1000, maxEntries: 10 });
    cache.set("short", "val1", 500);
    cache.set("long", "val2", 2000);

    vi.advanceTimersByTime(600);
    expect(cache.get("short")).toBeNull();
    expect(cache.get("long")).toBe("val2");
  });

  it("evicts oldest entries when maxEntries is exceeded", () => {
    const cache = new TtlCache<string>({ defaultTtlMs: 10000, maxEntries: 3 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.set("d", "4"); // Should evict "a"

    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("d")).toBe("4");
    expect(cache.getStats().evictions).toBe(1);
  });

  it("refreshes LRU order on get", () => {
    const cache = new TtlCache<string>({ defaultTtlMs: 10000, maxEntries: 3 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");

    // Access "a" to refresh its recency
    cache.get("a");
    cache.set("d", "4"); // Should evict "b" (oldest after refresh)

    expect(cache.get("a")).toBe("1");
    expect(cache.get("b")).toBeNull();
  });

  it("deletes individual keys", () => {
    const cache = new TtlCache<string>({ defaultTtlMs: 10000, maxEntries: 10 });
    cache.set("key", "value");
    cache.delete("key");
    expect(cache.get("key")).toBeNull();
  });

  it("invalidates keys by prefix", () => {
    const cache = new TtlCache<string>({ defaultTtlMs: 10000, maxEntries: 10 });
    cache.set("doc:1:blocks", "a");
    cache.set("doc:1:info", "b");
    cache.set("doc:2:blocks", "c");

    const removed = cache.invalidatePrefix("doc:1:");
    expect(removed).toBe(2);
    expect(cache.get("doc:1:blocks")).toBeNull();
    expect(cache.get("doc:2:blocks")).toBe("c");
  });

  it("cleans up expired entries", () => {
    const cache = new TtlCache<string>({ defaultTtlMs: 1000, maxEntries: 10 });
    cache.set("a", "1");
    cache.set("b", "2");

    vi.advanceTimersByTime(1001);
    const removed = cache.cleanupExpired();
    expect(removed).toBe(2);
    expect(cache.getStats().size).toBe(0);
  });

  it("clears all entries", () => {
    const cache = new TtlCache<string>({ defaultTtlMs: 10000, maxEntries: 10 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.getStats().size).toBe(0);
  });

  it("tracks stats correctly", () => {
    const cache = new TtlCache<string>({ defaultTtlMs: 1000, maxEntries: 2 });
    cache.set("a", "1");
    cache.get("a"); // hit
    cache.get("missing"); // miss
    cache.set("b", "2");
    cache.set("c", "3"); // eviction

    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.evictions).toBe(1);
    expect(stats.size).toBe(2);
  });

  describe("getOrLoad", () => {
    it("calls loader on cache miss and caches result", async () => {
      const cache = new TtlCache<string>({ defaultTtlMs: 10000, maxEntries: 10 });
      const loader = vi.fn().mockResolvedValue("loaded");

      const result = await cache.getOrLoad("key", loader);
      expect(result).toBe("loaded");
      expect(loader).toHaveBeenCalledOnce();

      // Second call should use cache
      const result2 = await cache.getOrLoad("key", loader);
      expect(result2).toBe("loaded");
      expect(loader).toHaveBeenCalledOnce();
    });

    it("deduplicates concurrent loads for same key", async () => {
      const cache = new TtlCache<string>({ defaultTtlMs: 10000, maxEntries: 10 });
      let resolveLoader: (v: string) => void;
      const loader = vi.fn().mockImplementation(
        () => new Promise<string>((resolve) => { resolveLoader = resolve; }),
      );

      const p1 = cache.getOrLoad("key", loader);
      const p2 = cache.getOrLoad("key", loader);
      expect(loader).toHaveBeenCalledOnce();

      resolveLoader!("value");
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe("value");
      expect(r2).toBe("value");
    });

    it("respects shouldCache option", async () => {
      const cache = new TtlCache<string>({ defaultTtlMs: 10000, maxEntries: 10 });
      const loader = vi.fn().mockResolvedValue("skip");

      await cache.getOrLoad("key", loader, { shouldCache: () => false });
      expect(cache.get("key")).toBeNull();
    });

    it("cleans up inFlight on loader failure", async () => {
      const cache = new TtlCache<string>({ defaultTtlMs: 10000, maxEntries: 10 });
      const loader = vi.fn().mockRejectedValue(new Error("fail"));

      await expect(cache.getOrLoad("key", loader)).rejects.toThrow("fail");
      expect(cache.getStats().inFlight).toBe(0);
    });
  });
});
