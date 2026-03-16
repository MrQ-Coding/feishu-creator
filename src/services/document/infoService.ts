import type { AppConfig } from "../../config.js";
import type {
  NotePlatformDocumentGateway,
  NotePlatformProvider,
} from "../../platform/index.js";
import { TtlCache } from "../../utils/ttlCache.js";

export interface GetDocumentInfoOptions {
  authTypeOverride?: "tenant" | "user";
}

export class DocumentInfoService {
  private readonly cache: TtlCache<Record<string, unknown>>;

  constructor(
    private readonly documentGateway: NotePlatformDocumentGateway,
    private readonly notePlatformProvider: NotePlatformProvider,
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
    options?: GetDocumentInfoOptions,
  ): Promise<Record<string, unknown>> {
    const type = documentType ?? this.notePlatformProvider.detectDocumentType(documentId);
    if (type === "wiki") {
      const wikiToken = this.notePlatformProvider.extractWikiToken(documentId);
      if (!wikiToken) {
        throw new Error("Invalid wiki token or wiki URL.");
      }
      const key = this.buildCacheKey(type, wikiToken);
      const load = async () =>
        this.loadWikiInfo(wikiToken, options?.authTypeOverride);
      if (options?.authTypeOverride) {
        return load();
      }
      return this.cache.getOrLoad(key, load);
    }

    const normalizedDocumentId = this.notePlatformProvider.extractDocumentId(documentId);
    if (!normalizedDocumentId) {
      throw new Error("Invalid document ID or document URL.");
    }
    const key = this.buildCacheKey(type, normalizedDocumentId);
    const load = async () =>
      this.loadDocumentInfo(normalizedDocumentId, options?.authTypeOverride);
    if (options?.authTypeOverride) {
      return load();
    }
    return this.cache.getOrLoad(key, load);
  }

  invalidateByPrefix(prefix: "document" | "wiki"): number {
    return this.cache.invalidatePrefix(`${prefix}:`);
  }

  invalidateDocument(documentId: string): void {
    const normalizedDocumentId = this.notePlatformProvider.extractDocumentId(documentId);
    if (!normalizedDocumentId) return;
    this.cache.delete(this.buildCacheKey("document", normalizedDocumentId));
  }

  invalidateWiki(wikiTokenOrUrl: string): void {
    const wikiToken = this.notePlatformProvider.extractWikiToken(wikiTokenOrUrl);
    if (!wikiToken) return;
    this.cache.delete(this.buildCacheKey("wiki", wikiToken));
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

  private async loadWikiInfo(
    wikiToken: string,
    authTypeOverride?: "tenant" | "user",
  ): Promise<Record<string, unknown>> {
    const { node } = await this.documentGateway.getWikiInfo(
      wikiToken,
      authTypeOverride,
    );
    if (!node.obj_token) {
      throw new Error("Wiki node response missing obj_token.");
    }
    return {
      ...node,
      documentId: node.obj_token,
      _type: "wiki",
    };
  }

  private async loadDocumentInfo(
    documentId: string,
    authTypeOverride?: "tenant" | "user",
  ): Promise<Record<string, unknown>> {
    const { document: data } = await this.documentGateway.getDocumentInfo(
      documentId,
      authTypeOverride,
    );
    return {
      ...data,
      _type: "document",
    };
  }
}
