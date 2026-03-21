import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FeishuClient } from "../client.js";
import type { FeishuAuthManager } from "../authManager.js";
import type { AppConfig } from "../../config.js";

function createMockAuthManager(): FeishuAuthManager {
  return {
    getAccessToken: vi.fn().mockResolvedValue("mock-token"),
    invalidateCachedAccessToken: vi.fn(),
  } as unknown as FeishuAuthManager;
}

function createTestConfig(overrides: Partial<AppConfig["feishu"]> = {}): AppConfig["feishu"] {
  return {
    appId: "test-app",
    appSecret: "test-secret",
    baseUrl: "https://mock.feishu.cn/open-apis",
    uiBaseUrl: "https://mock.feishu.cn",
    authType: "tenant",
    maxConcurrency: 8,
    requestMaxRetries: 2,
    requestBackoffBaseMs: 10,
    tokenRefreshBeforeSeconds: 300,
    oauthStateTtlSeconds: 600,
    docInfoCacheTtlSeconds: 60,
    docBlocksCacheTtlSeconds: 30,
    wikiSpacesCacheTtlSeconds: 120,
    wikiTreeCacheTtlSeconds: 120,
    wikiTreeMaxConcurrency: 6,
    cacheMaxEntries: 500,
    cacheCleanupIntervalSeconds: 60,
    wikiDeleteStrategy: "playwright",
    playwrightHeadless: true,
    playwrightLoginRecoveryMode: "on_demand",
    playwrightActionTimeoutMs: 30000,
    playwrightLoginTimeoutMs: 120000,
    ...overrides,
  } as AppConfig["feishu"];
}

describe("FeishuClient", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes successful GET request", async () => {
    const auth = createMockAuthManager();
    const client = new FeishuClient(createTestConfig(), auth);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 0, data: { id: "123" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await client.request<{ id: string }>("/test/path");
    expect(result).toEqual({ id: "123" });

    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://mock.feishu.cn/open-apis/test/path");
    expect(options.method).toBe("GET");
    expect(options.headers).toHaveProperty("Authorization", "Bearer mock-token");
  });

  it("retries on 429 status", async () => {
    const auth = createMockAuthManager();
    const client = new FeishuClient(
      createTestConfig({ requestMaxRetries: 1, requestBackoffBaseMs: 1 }),
      auth,
    );

    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 99991672, msg: "rate limited" }), {
          status: 429,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, data: { ok: true } }), {
          status: 200,
        }),
      );

    const result = await client.request<{ ok: boolean }>("/test");
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("retries on 500 status", async () => {
    const auth = createMockAuthManager();
    const client = new FeishuClient(
      createTestConfig({ requestMaxRetries: 1, requestBackoffBaseMs: 1 }),
      auth,
    );

    fetchSpy
      .mockResolvedValueOnce(
        new Response("Internal Server Error", { status: 500 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 }),
      );

    await client.request("/test");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    const auth = createMockAuthManager();
    const client = new FeishuClient(
      createTestConfig({ requestMaxRetries: 1, requestBackoffBaseMs: 1 }),
      auth,
    );

    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response("error", { status: 502 })),
    );

    await expect(client.request("/test")).rejects.toThrow("Feishu API HTTP 502");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("refreshes token on auth expired error (401)", async () => {
    const auth = createMockAuthManager();
    const client = new FeishuClient(
      createTestConfig({ requestMaxRetries: 0, requestBackoffBaseMs: 1 }),
      auth,
    );

    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 99991663, msg: "token expired" }), {
          status: 401,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, data: { ok: true } }), {
          status: 200,
        }),
      );

    const result = await client.request<{ ok: boolean }>("/test");
    expect(result).toEqual({ ok: true });
    expect(auth.invalidateCachedAccessToken).toHaveBeenCalledOnce();
  });

  it("sends JSON body for POST requests", async () => {
    const auth = createMockAuthManager();
    const client = new FeishuClient(createTestConfig(), auth);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 }),
    );

    await client.request("/test", "POST", { title: "hello" });

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(options.method).toBe("POST");
    expect(options.body).toBe(JSON.stringify({ title: "hello" }));
  });

  it("appends query parameters", async () => {
    const auth = createMockAuthManager();
    const client = new FeishuClient(createTestConfig(), auth);

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 }),
    );

    await client.request("/test", "GET", undefined, { page: 1, size: 10 });

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("page=1");
    expect(url).toContain("size=10");
  });

  it("throws on non-zero API code with 200 status", async () => {
    const auth = createMockAuthManager();
    const client = new FeishuClient(
      createTestConfig({ requestMaxRetries: 0 }),
      auth,
    );

    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 230001, msg: "no permission" }), {
        status: 200,
      }),
    );

    await expect(client.request("/test")).rejects.toThrow("code=230001");
  });
});
