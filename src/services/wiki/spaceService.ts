import type { AppConfig } from "../../config.js";
import type { NotePlatformKnowledgeGateway } from "../../platform/index.js";
import { TtlCache } from "../../utils/ttlCache.js";

export class WikiSpaceService {
  private readonly cache: TtlCache<Array<Record<string, unknown>>>;
  private readonly cacheKey: string;

  constructor(
    private readonly knowledgeGateway: NotePlatformKnowledgeGateway,
    config: AppConfig["feishu"],
  ) {
    this.cache = new TtlCache<Array<Record<string, unknown>>>({
      defaultTtlMs: config.wikiSpacesCacheTtlSeconds * 1000,
      maxEntries: Math.max(20, Math.floor(config.cacheMaxEntries / 4)),
    });
    this.cacheKey = `wiki-spaces:${config.authType}:${config.appId}`;
  }

  async listAllSpaces(pageSize: number): Promise<Array<Record<string, unknown>>> {
    const safePageSize = this.clampPageSize(pageSize);
    return this.cache.getOrLoad(this.cacheKey, () => this.fetchAllSpaces(safePageSize));
  }

  private async fetchAllSpaces(
    pageSize: number,
  ): Promise<Array<Record<string, unknown>>> {
    const items: Array<Record<string, unknown>> = [];
    let pageToken: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const page = await this.knowledgeGateway.listWikiSpaces({
        pageSize,
        pageToken,
      });

      if (page.items.length > 0) {
        items.push(...page.items);
      }

      hasMore = page.hasMore;
      if (hasMore && !page.pageToken) {
        throw new Error(
          "Wiki spaces pagination returned hasMore=true without pageToken.",
        );
      }
      pageToken = page.pageToken;
    }

    return items;
  }

  private clampPageSize(pageSize: number): number {
    if (!Number.isFinite(pageSize)) return 50;
    return Math.max(1, Math.min(50, Math.floor(pageSize)));
  }

  invalidateAll(): void {
    this.cache.delete(this.cacheKey);
  }

  cleanupExpired(): number {
    return this.cache.cleanupExpired();
  }

  getCacheStats() {
    return this.cache.getStats();
  }
}
