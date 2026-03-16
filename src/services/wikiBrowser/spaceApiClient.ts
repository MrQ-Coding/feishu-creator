import type { BrowserContext } from "playwright";
import type { AppConfig } from "../../config.js";
import {
  normalizeUiBaseUrl,
  resolveRequestReferer,
} from "./helpers.js";
import type {
  ReusableBrowserSession,
  SpaceApiEnvelope,
  SpaceApiRequest,
  SpaceApiResponse,
} from "./types.js";
import { INTERNAL_API_SUCCESS_CODE } from "./types.js";

export async function requestSpaceApi<TData>(
  session: ReusableBrowserSession,
  request: SpaceApiRequest,
  config: AppConfig["feishu"],
): Promise<SpaceApiResponse<TData>> {
  const csrfToken = await readCsrfToken(session.context, config);
  const url = new URL(request.path, `${normalizeUiBaseUrl(config)}/`).toString();
  const headers: Record<string, string> = {};
  if (request.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (csrfToken) {
    headers["x-csrftoken"] = csrfToken;
  }
  headers.Origin = normalizeUiBaseUrl(config);
  headers.Referer = resolveRequestReferer(config, session.page.url());

  try {
    const response = await session.context.request.fetch(url, {
      method: request.method,
      headers,
      failOnStatusCode: false,
      data:
        request.body === undefined
          ? undefined
          : JSON.stringify(request.body),
    });
    const text = await response.text();
    let json: SpaceApiEnvelope<TData> | null = null;
    try {
      json = JSON.parse(text) as SpaceApiEnvelope<TData>;
    } catch {
      json = null;
    }

    return {
      status: response.status(),
      text,
      json,
      csrfToken,
    };
  } catch (error) {
    return {
      status: 0,
      text: error instanceof Error ? error.message : String(error),
      json: null,
      csrfToken,
    };
  }
}

export async function hasActiveWebSession(
  session: ReusableBrowserSession,
  config: AppConfig["feishu"],
): Promise<boolean> {
  const response = await requestSpaceApi<Record<string, unknown>>(
    session,
    {
      method: "GET",
      path: "/space/api/user/",
    },
    config,
  );
  return response.status === 200 && response.json?.code === INTERNAL_API_SUCCESS_CODE;
}

async function readCsrfToken(
  context: BrowserContext,
  config: AppConfig["feishu"],
): Promise<string | undefined> {
  const cookies = await context.cookies(config.uiBaseUrl);
  return cookies.find((cookie) => cookie.name === "_csrf_token")?.value;
}
