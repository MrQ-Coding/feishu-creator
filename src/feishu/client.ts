import type { AppConfig } from "../config.js";
import { FeishuAuthManager } from "./authManager.js";
import { Logger } from "../logger.js";

type RequestMethod = "GET" | "POST" | "PATCH" | "DELETE" | "PUT";

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

class FeishuRequestError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly apiCode?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export class FeishuClient {
  private readonly semaphore: Semaphore;
  private static readonly RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504]);
  private static readonly RETRYABLE_API_CODE = new Set([99991672]);
  private static readonly AUTH_EXPIRED_API_CODE = new Set([99991663, 99991677]);

  constructor(
    private readonly config: AppConfig["feishu"],
    private readonly authManager: FeishuAuthManager,
  ) {
    this.semaphore = new Semaphore(config.maxConcurrency);
  }

  async request<T>(
    path: string,
    method: RequestMethod = "GET",
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    return this.semaphore.withLock(() =>
      this.requestWithRetry<T>(path, method, body, query),
    );
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const base = `${this.config.baseUrl}${normalizedPath}`;
    const url = new URL(base);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async requestWithRetry<T>(
    path: string,
    method: RequestMethod,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const maxAttempts = this.config.requestMaxRetries + 1;
    let lastError: unknown;
    let authRecoveryAttempted = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.requestOnce<T>(path, method, body, query);
      } catch (error) {
        let currentError: unknown = error;

        if (this.isAuthExpiredError(currentError) && !authRecoveryAttempted) {
          authRecoveryAttempted = true;
          this.authManager.invalidateCachedAccessToken(
            `auth expired response for ${path}`,
          );
          Logger.warn(`Feishu auth token expired, refreshing and retrying once: ${path}`);
          try {
            return await this.requestOnce<T>(path, method, body, query);
          } catch (retryError) {
            currentError = retryError;
          }
        }

        lastError = currentError;
        const retryable = this.isRetryableError(currentError);
        const shouldRetry = retryable && attempt < maxAttempts;
        if (!shouldRetry) break;

        const backoffMs = this.computeBackoffMs(attempt, currentError);
        Logger.warn(
          `Feishu request retry ${attempt}/${maxAttempts - 1} in ${backoffMs}ms: ${path}`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Unknown request failure for ${path}`);
  }

  private async requestOnce<T>(
    path: string,
    method: RequestMethod,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const accessToken = await this.authManager.getAccessToken();
    const url = this.buildUrl(path, query);
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    const json = this.safeParseJson(text) as
      | { code?: number; msg?: string; data?: T }
      | null;

    if (!response.ok) {
      const retryAfterMs = this.parseRetryAfterMs(
        response.headers.get("retry-after"),
      );
      const apiCode =
        json && typeof json.code === "number" ? json.code : undefined;
      throw new FeishuRequestError(
        `Feishu API HTTP ${response.status}: ${text}`,
        response.status,
        apiCode,
        retryAfterMs,
      );
    }

    if (json && typeof json.code === "number" && json.code !== 0) {
      const retryAfterMs = this.parseRetryAfterMs(
        response.headers.get("retry-after"),
      );
      throw new FeishuRequestError(
        `Feishu API code=${json.code}, msg=${json.msg ?? "unknown"}`,
        response.status,
        json.code,
        retryAfterMs,
      );
    }

    if (json && "data" in json) {
      return (json.data ?? (json as unknown as T)) as T;
    }
    return (json as unknown as T) ?? ({} as T);
  }

  private safeParseJson(text: string): unknown {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof FeishuRequestError) {
      if (error.status && FeishuClient.RETRYABLE_HTTP.has(error.status)) return true;
      if (error.apiCode && FeishuClient.RETRYABLE_API_CODE.has(error.apiCode)) return true;
      return false;
    }
    // Network/transport level error from fetch.
    if (!(error instanceof Error)) return false;
    const transientKeywords = [
      "fetch failed",
      "network",
      "timeout",
      "socket hang up",
      "econnreset",
      "etimedout",
      "eai_again",
    ];
    const lower = error.message.toLowerCase();
    return transientKeywords.some((k) => lower.includes(k));
  }

  private isAuthExpiredError(error: unknown): boolean {
    if (!(error instanceof FeishuRequestError)) {
      return false;
    }
    if (error.status === 401) {
      return true;
    }
    if (
      typeof error.apiCode === "number" &&
      FeishuClient.AUTH_EXPIRED_API_CODE.has(error.apiCode)
    ) {
      return true;
    }
    const message = error.message.toLowerCase();
    return (
      message.includes("token expired") ||
      message.includes("invalid access token")
    );
  }

  private computeBackoffMs(attempt: number, error: unknown): number {
    const retryAfterMs =
      error instanceof FeishuRequestError && Number.isFinite(error.retryAfterMs)
        ? Math.max(0, Math.floor(error.retryAfterMs as number))
        : 0;
    const throttleMultiplier =
      error instanceof FeishuRequestError && error.status === 429 ? 4 : 1;
    const base =
      this.config.requestBackoffBaseMs *
      throttleMultiplier *
      2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * 120);
    return Math.max(base, retryAfterMs) + jitter;
  }

  private parseRetryAfterMs(headerValue: string | null): number | undefined {
    if (!headerValue) return undefined;
    const seconds = Number(headerValue);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.floor(seconds * 1000);
    }
    const retryAtMs = Date.parse(headerValue);
    if (!Number.isFinite(retryAtMs)) return undefined;
    return Math.max(0, retryAtMs - Date.now());
  }
}
