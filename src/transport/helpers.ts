import { timingSafeEqual } from "node:crypto";

export function pickFirstQueryString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value) && value.length > 0) {
    return pickFirstQueryString(value[0]);
  }
  return undefined;
}

export function parseBooleanQuery(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  const normalized = value.toLowerCase();
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  return defaultValue;
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function maskToken(token: string): string {
  if (token.length <= 12) return "***";
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

export function extractBearerToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  const match = normalized.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : undefined;
}

export function secureTokenEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function pickFirstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value) && value.length > 0) {
    return pickFirstHeaderValue(value[0]);
  }
  return undefined;
}

export function parsePositiveIntHeader(name: string, value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid header ${name}: expected a positive integer.`);
  }
  return parsed;
}

/**
 * Transient network error keywords shared by FeishuClient retry logic and auth diagnostics.
 */
export const TRANSIENT_ERROR_KEYWORDS = [
  "fetch failed",
  "network",
  "timeout",
  "socket hang up",
  "econnreset",
  "etimedout",
  "eai_again",
] as const;

export function isLikelyTransportError(message: string): boolean {
  const lower = message.toLowerCase();
  return TRANSIENT_ERROR_KEYWORDS.some((k) => lower.includes(k));
}
