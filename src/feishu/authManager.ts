import type { AppConfig } from "../config.js";
import { Logger } from "../logger.js";

type FeishuConfig = AppConfig["feishu"];

interface TenantTokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number;
}

interface UserTokenRefreshResponse {
  code: number;
  msg: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  data?: Record<string, unknown>;
}

interface UserTokenCodeExchangeResponse {
  code: number;
  msg: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  data?: Record<string, unknown>;
}

interface NormalizedUserTokenPayload {
  code: number;
  msg: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
}

export interface UserTokenSetResult {
  accessToken: string;
  refreshToken?: string;
  expiresAtUnixSec: number;
}

export interface AuthStatus {
  authType: "tenant" | "user";
  configuredAuthType: "tenant" | "user";
  effectiveAuthType: "tenant" | "user";
  hasAppCredentials: boolean;
  hasConfiguredUserAccessToken: boolean;
  hasConfiguredUserRefreshToken: boolean;
  hasCachedTenantToken: boolean;
  hasCachedUserToken: boolean;
  cachedTenantTokenExpiresAt: number | null;
  cachedUserTokenExpiresAt: number | null;
}

type UserTokenUpdateHandler = (result: UserTokenSetResult) => Promise<void> | void;

export class FeishuAuthManager {
  private readonly config: FeishuConfig;
  private tenantAccessToken: string | null = null;
  private tenantExpiresAt = 0;
  private tenantRefreshPromise: Promise<string> | null = null;

  private userAccessToken: string | null;
  private userRefreshToken: string | null;
  private userExpiresAt = Number.POSITIVE_INFINITY;
  private userRefreshPromise: Promise<string> | null = null;
  private authTypeOverride: "tenant" | "user" | null = null;
  private userTokenUpdateHandler: UserTokenUpdateHandler | null = null;

  constructor(config: FeishuConfig) {
    this.config = config;
    this.userAccessToken = config.userAccessToken ?? null;
    this.userRefreshToken = config.userRefreshToken ?? null;
  }

  async getAccessToken(): Promise<string> {
    if (this.getEffectiveAuthType() === "tenant") {
      return this.getTenantAccessToken();
    }
    return this.getUserAccessToken();
  }

  getStatus(): AuthStatus {
    const effectiveAuthType = this.getEffectiveAuthType();
    return {
      // Kept for backward compatibility with existing tool output.
      authType: effectiveAuthType,
      configuredAuthType: this.config.authType,
      effectiveAuthType,
      hasAppCredentials: Boolean(this.config.appId && this.config.appSecret),
      hasConfiguredUserAccessToken: Boolean(this.config.userAccessToken),
      hasConfiguredUserRefreshToken: Boolean(this.config.userRefreshToken),
      hasCachedTenantToken: Boolean(this.tenantAccessToken),
      hasCachedUserToken: Boolean(this.userAccessToken),
      cachedTenantTokenExpiresAt:
        this.tenantExpiresAt > 0 ? this.tenantExpiresAt : null,
      cachedUserTokenExpiresAt: Number.isFinite(this.userExpiresAt)
        ? this.userExpiresAt
        : null,
    };
  }

  setAuthTypeOverride(authType?: "tenant" | "user"): "tenant" | "user" {
    this.authTypeOverride = authType ?? null;
    return this.getEffectiveAuthType();
  }

  setUserTokenUpdateHandler(handler?: UserTokenUpdateHandler): void {
    this.userTokenUpdateHandler = handler ?? null;
  }

  buildUserAuthorizeUrl(redirectUri: string, state?: string): string {
    const normalizedRedirect = redirectUri.trim();
    if (!normalizedRedirect) {
      throw new Error("redirectUri is required.");
    }
    const baseOrigin = this.config.baseUrl.replace(/\/open-apis\/?$/, "");
    const url = new URL(`${baseOrigin}/open-apis/authen/v1/authorize`);
    url.searchParams.set("app_id", this.config.appId);
    url.searchParams.set("redirect_uri", normalizedRedirect);
    url.searchParams.set("response_type", "code");
    if (state?.trim()) {
      url.searchParams.set("state", state.trim());
    }
    return url.toString();
  }

  async exchangeUserAuthorizationCode(
    code: string,
    redirectUri?: string,
  ): Promise<UserTokenSetResult> {
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      throw new Error("code is required.");
    }
    const url = `${this.config.baseUrl.replace(
      /\/open-apis\/?$/,
      "",
    )}/open-apis/authen/v1/access_token`;
    const payload: Record<string, unknown> = {
      grant_type: "authorization_code",
      code: normalizedCode,
      app_id: this.config.appId,
      app_secret: this.config.appSecret,
    };
    if (redirectUri?.trim()) {
      payload.redirect_uri = redirectUri.trim();
    }

    const response = await this.postJson<UserTokenCodeExchangeResponse>(url, payload);
    Logger.info(
      `User auth code exchange raw shape: topLevelKeys=${Object.keys(
        response as unknown as Record<string, unknown>,
      ).join(",")}, dataKeys=${
        response.data && typeof response.data === "object"
          ? Object.keys(response.data).join(",")
          : ""
      }`,
    );
    Logger.info(
      `User auth code exchange response fields: access_token=${Boolean(
        response.access_token,
      )}, refresh_token=${Boolean(response.refresh_token)}, expires_in=${Boolean(
        response.expires_in,
      )}, refresh_token_expires_in=${Boolean(response.refresh_token_expires_in)}`,
    );
    const normalized = this.normalizeUserTokenPayload(response);
    if (
      normalized.code !== 0 ||
      !normalized.access_token ||
      !normalized.expires_in
    ) {
      throw new Error(
        `Failed to exchange user auth code: ${normalized.msg || "unknown error"}`,
      );
    }
    return this.setUserTokens(
      normalized.access_token,
      normalized.refresh_token,
      normalized.expires_in,
    );
  }

  setUserTokens(
    accessToken: string,
    refreshToken?: string,
    expiresInSec?: number,
  ): UserTokenSetResult {
    const normalizedAccess = accessToken.trim();
    if (!normalizedAccess) {
      throw new Error("accessToken is required.");
    }
    this.userAccessToken = normalizedAccess;
    if (refreshToken?.trim()) {
      this.userRefreshToken = refreshToken.trim();
    }
    const safeExpiresIn =
      typeof expiresInSec === "number" && Number.isFinite(expiresInSec) && expiresInSec > 0
        ? Math.floor(expiresInSec)
        : 7200;
    this.userExpiresAt = Math.floor(Date.now() / 1000) + safeExpiresIn;
    return {
      accessToken: this.userAccessToken,
      refreshToken: this.userRefreshToken ?? undefined,
      expiresAtUnixSec: this.userExpiresAt,
    };
  }

  invalidateCachedAccessToken(reason?: string): void {
    const effectiveAuthType = this.getEffectiveAuthType();
    if (effectiveAuthType === "tenant") {
      this.tenantExpiresAt = 0;
      if (reason) {
        Logger.warn(`tenant_access_token cache invalidated: ${reason}`);
      }
      return;
    }

    this.userExpiresAt = 0;
    if (reason) {
      Logger.warn(`user_access_token cache invalidated: ${reason}`);
    }
  }

  private getEffectiveAuthType(): "tenant" | "user" {
    return this.authTypeOverride ?? this.config.authType;
  }

  private shouldRefresh(expiresAtUnixSec: number): boolean {
    const now = Math.floor(Date.now() / 1000);
    const remaining = expiresAtUnixSec - now;
    return remaining <= this.config.refreshBeforeSeconds;
  }

  private async getTenantAccessToken(): Promise<string> {
    if (this.tenantAccessToken && !this.shouldRefresh(this.tenantExpiresAt)) {
      return this.tenantAccessToken;
    }

    // Avoid token-stampede when multiple requests refresh simultaneously.
    if (this.tenantRefreshPromise) {
      return this.tenantRefreshPromise;
    }

    this.tenantRefreshPromise = this.refreshTenantAccessToken();
    try {
      return await this.tenantRefreshPromise;
    } finally {
      this.tenantRefreshPromise = null;
    }
  }

  private async refreshTenantAccessToken(): Promise<string> {
    const url = `${this.config.baseUrl}/auth/v3/tenant_access_token/internal`;
    const payload = {
      app_id: this.config.appId,
      app_secret: this.config.appSecret,
    };
    const response = await this.postJson<TenantTokenResponse>(url, payload);

    if (
      response.code !== 0 ||
      !response.tenant_access_token ||
      typeof response.expire !== "number"
    ) {
      throw new Error(
        `Failed to fetch tenant_access_token: ${response.msg || "unknown error"}`,
      );
    }

    this.tenantAccessToken = response.tenant_access_token;
    this.tenantExpiresAt = Math.floor(Date.now() / 1000) + response.expire;
    Logger.info("tenant_access_token refreshed");
    return this.tenantAccessToken;
  }

  private async getUserAccessToken(): Promise<string> {
    if (this.userAccessToken) {
      if (
        !Number.isFinite(this.userExpiresAt) ||
        !this.shouldRefresh(this.userExpiresAt)
      ) {
        return this.userAccessToken;
      }
    }

    if (!this.userRefreshToken) {
      throw new Error(
        "User auth mode requires FEISHU_USER_ACCESS_TOKEN or FEISHU_USER_REFRESH_TOKEN.",
      );
    }

    if (this.userRefreshPromise) {
      return this.userRefreshPromise;
    }

    this.userRefreshPromise = this.refreshUserAccessToken();
    try {
      return await this.userRefreshPromise;
    } finally {
      this.userRefreshPromise = null;
    }
  }

  private async refreshUserAccessToken(): Promise<string> {
    const url = `${this.config.baseUrl.replace(
      "/open-apis",
      "",
    )}/open-apis/authen/v1/refresh_access_token`;
    const payload = {
      grant_type: "refresh_token",
      app_id: this.config.appId,
      app_secret: this.config.appSecret,
      refresh_token: this.userRefreshToken,
    };
    const response = await this.postJson<UserTokenRefreshResponse>(url, payload);
    Logger.info(
      `User refresh raw shape: topLevelKeys=${Object.keys(
        response as unknown as Record<string, unknown>,
      ).join(",")}, dataKeys=${
        response.data && typeof response.data === "object"
          ? Object.keys(response.data).join(",")
          : ""
      }`,
    );
    Logger.info(
      `User refresh response fields: access_token=${Boolean(
        response.access_token,
      )}, refresh_token=${Boolean(response.refresh_token)}, expires_in=${Boolean(
        response.expires_in,
      )}, refresh_token_expires_in=${Boolean(response.refresh_token_expires_in)}`,
    );
    const normalized = this.normalizeUserTokenPayload(response);

    if (
      normalized.code !== 0 ||
      !normalized.access_token ||
      !normalized.expires_in
    ) {
      throw new Error(
        `Failed to refresh user_access_token: ${normalized.msg || "unknown error"}`,
      );
    }

    this.userAccessToken = normalized.access_token;
    this.userExpiresAt = Math.floor(Date.now() / 1000) + normalized.expires_in;
    if (normalized.refresh_token) {
      this.userRefreshToken = normalized.refresh_token;
    }
    Logger.info("user_access_token refreshed");
    this.notifyUserTokenUpdated({
      accessToken: this.userAccessToken,
      refreshToken: this.userRefreshToken ?? undefined,
      expiresAtUnixSec: this.userExpiresAt,
    });
    return this.userAccessToken;
  }

  private notifyUserTokenUpdated(result: UserTokenSetResult): void {
    if (!this.userTokenUpdateHandler) {
      return;
    }
    Promise.resolve(this.userTokenUpdateHandler(result)).catch((error) => {
      Logger.warn(
        `Failed to persist updated user token: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  private normalizeUserTokenPayload(
    response: UserTokenCodeExchangeResponse | UserTokenRefreshResponse,
  ): NormalizedUserTokenPayload {
    const nested =
      response.data && typeof response.data === "object" ? response.data : undefined;

    return {
      code:
        typeof response.code === "number"
          ? response.code
          : typeof nested?.code === "number"
            ? nested.code
            : 0,
      msg:
        typeof response.msg === "string"
          ? response.msg
          : typeof nested?.msg === "string"
            ? nested.msg
            : "unknown error",
      access_token:
        typeof response.access_token === "string"
          ? response.access_token
          : typeof nested?.access_token === "string"
            ? nested.access_token
            : undefined,
      refresh_token:
        typeof response.refresh_token === "string"
          ? response.refresh_token
          : typeof nested?.refresh_token === "string"
            ? nested.refresh_token
            : undefined,
      expires_in:
        typeof response.expires_in === "number"
          ? response.expires_in
          : typeof nested?.expires_in === "number"
            ? nested.expires_in
            : undefined,
      refresh_token_expires_in:
        typeof response.refresh_token_expires_in === "number"
          ? response.refresh_token_expires_in
          : typeof nested?.refresh_token_expires_in === "number"
            ? nested.refresh_token_expires_in
            : undefined,
    };
  }

  private async postJson<T>(url: string, payload: unknown): Promise<T> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status} for ${url}: ${body}`);
    }

    return (await response.json()) as T;
  }
}
