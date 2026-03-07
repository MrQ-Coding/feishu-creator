interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface TtlCacheOptions {
  defaultTtlMs: number;
  maxEntries: number;
}

interface LoadOptions<T> {
  ttlMs?: number;
  shouldCache?: (value: T) => boolean;
}

export interface TtlCacheStats {
  size: number;
  hits: number;
  misses: number;
  expired: number;
  evictions: number;
  inFlight: number;
}

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;

  private hits = 0;
  private misses = 0;
  private expired = 0;
  private evictions = 0;

  constructor(options: TtlCacheOptions) {
    this.defaultTtlMs = options.defaultTtlMs;
    this.maxEntries = options.maxEntries;
  }

  get(key: string): T | null {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses += 1;
      return null;
    }

    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      this.expired += 1;
      this.misses += 1;
      return null;
    }

    // Refresh recency in map order (LRU-style).
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    const effectiveTtlMs = ttlMs ?? this.defaultTtlMs;
    const expiresAt = Date.now() + effectiveTtlMs;
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, { value, expiresAt });
    this.evictIfNeeded();
  }

  async getOrLoad(
    key: string,
    loader: () => Promise<T>,
    options?: LoadOptions<T>,
  ): Promise<T> {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }

    const promise = loader();
    this.inFlight.set(key, promise);

    try {
      const value = await promise;
      const shouldCache = options?.shouldCache ?? (() => true);
      if (shouldCache(value)) {
        this.set(key, value, options?.ttlMs);
      }
      return value;
    } finally {
      this.inFlight.delete(key);
    }
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  invalidatePrefix(prefix: string): number {
    let removed = 0;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  cleanupExpired(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        removed += 1;
        this.expired += 1;
      }
    }
    return removed;
  }

  getStats(): TtlCacheStats {
    return {
      size: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      expired: this.expired,
      evictions: this.evictions,
      inFlight: this.inFlight.size,
    };
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
      this.evictions += 1;
    }
  }
}

