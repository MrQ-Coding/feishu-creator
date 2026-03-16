import type { AppConfig } from "../../config.js";
import type { DeleteWikiNodeInput } from "./types.js";

export function normalizeUiBaseUrl(config: AppConfig["feishu"]): string {
  return config.uiBaseUrl.replace(/\/+$/, "");
}

export function buildWikiUrl(
  config: AppConfig["feishu"],
  nodeToken: string,
): string {
  return `${normalizeUiBaseUrl(config)}/wiki/${nodeToken}`;
}

export function buildDocumentUrl(
  config: AppConfig["feishu"],
  documentId: string,
): string {
  return `${normalizeUiBaseUrl(config)}/docx/${documentId}`;
}

export function buildWikiHomeUrl(config: AppConfig["feishu"]): string {
  return `${normalizeUiBaseUrl(config)}/wiki/`;
}

export function describeDeleteTarget(
  config: AppConfig["feishu"],
  input: DeleteWikiNodeInput,
): string {
  if (input.title) {
    return input.title;
  }
  const nodeToken = input.nodeToken?.trim();
  if (nodeToken) {
    return buildWikiUrl(config, nodeToken);
  }
  const documentId = input.documentId?.trim();
  if (documentId) {
    return buildDocumentUrl(config, documentId);
  }
  return "unknown target";
}

export function formatResponsePreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 240 ? `${normalized.slice(0, 240)}...` : normalized;
}

export function resolveRequestReferer(
  config: AppConfig["feishu"],
  currentPageUrl: string,
): string {
  const uiBaseUrl = normalizeUiBaseUrl(config);
  if (currentPageUrl && currentPageUrl.startsWith(uiBaseUrl)) {
    return currentPageUrl;
  }
  return buildWikiHomeUrl(config);
}

export function isLoginPage(url: string): boolean {
  return url.includes("/accounts/page/login") || url.includes("accounts.feishu.cn");
}

export function isDeletedLandingPage(url: string): boolean {
  return url.includes("/drive/home/");
}
