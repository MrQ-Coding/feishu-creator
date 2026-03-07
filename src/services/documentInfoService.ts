import type { AppConfig } from "../config.js";
import type { FeishuClient } from "../feishu/client.js";
import {
  detectDocumentType,
  extractDocumentId,
  extractWikiToken,
} from "../feishu/document.js";
import { TtlCache } from "../utils/ttlCache.js";

export class DocumentInfoService {
  private readonly cache: TtlCache<Record<string, unknown>>;

  constructor(
    private readonly feishuClient: FeishuClient,
    config: AppConfig["feishu"],
  ) {
    this.cache = new TtlCache<Record<string, unknown>>({
      defaultTtlMs: config.docInfoCacheTtlSeconds * 1000,
      maxEntries: config.cacheMaxEntries,
    });
  }

  async getDocumentInfo(
    documentId: string,
    documentType?: "document" | "wiki",
  ): Promise<Record<string, unknown>> {
    const type = documentType ?? detectDocumentType(documentId);
    if (type === "wiki") {
      const wikiToken = extractWikiToken(documentId);
      if (!wikiToken) {
        throw new Error("Invalid wiki token or wiki URL.");
      }
      const key = this.buildCacheKey(type, wikiToken);
      return this.cache.getOrLoad(key, async () => {
        const data = await this.feishuClient.request<{
          node?: Record<string, unknown> & { obj_token?: string };
        }>("/wiki/v2/spaces/get_node", "GET", undefined, {
          token: wikiToken,
          obj_type: "wiki",
        });
        if (!data.node || !data.node.obj_token) {
          throw new Error("Wiki node response missing obj_token.");
        }
        return {
          ...data.node,
          documentId: data.node.obj_token,
          _type: "wiki",
        };
      });
    }

    const normalizedDocumentId = extractDocumentId(documentId);
    if (!normalizedDocumentId) {
      throw new Error("Invalid document ID or document URL.");
    }
    const key = this.buildCacheKey(type, normalizedDocumentId);
    return this.cache.getOrLoad(key, async () => {
      const data = await this.feishuClient.request<Record<string, unknown>>(
        `/docx/v1/documents/${normalizedDocumentId}`,
        "GET",
      );
      return {
        ...data,
        _type: "document",
      };
    });
  }

  invalidateByPrefix(prefix: "document" | "wiki"): number {
    return this.cache.invalidatePrefix(`${prefix}:`);
  }

  invalidateDocument(documentId: string): void {
    const normalizedDocumentId = extractDocumentId(documentId);
    if (!normalizedDocumentId) return;
    this.cache.delete(this.buildCacheKey("document", normalizedDocumentId));
  }

  cleanupExpired(): number {
    return this.cache.cleanupExpired();
  }

  getCacheStats() {
    return this.cache.getStats();
  }

  private buildCacheKey(type: "document" | "wiki", normalizedId: string): string {
    return `${type}:${normalizedId}`;
  }
}
