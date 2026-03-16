import type { AppConfig } from "../../config.js";
import type { FeishuClient } from "../../feishu/client.js";
import { extractDocumentId } from "../../feishu/document.js";
import { TtlCache } from "../../utils/ttlCache.js";

interface DocumentBlockListResponse {
  items?: Array<Record<string, unknown>>;
  has_more?: boolean;
  page_token?: string;
}

interface DocumentBlockChildrenListResponse {
  items?: Array<Record<string, unknown>>;
  has_more?: boolean;
  page_token?: string;
}

export interface GetDocumentBlocksOptions {
  pageSize?: number;
  maxBlocks?: number;
  maxDepth?: number;
}

export interface GetDocumentBlocksResult {
  blocks: Array<Record<string, unknown>>;
  truncated: boolean;
  maxBlocks?: number;
  maxDepth?: number;
}

export class DocumentBlockService {
  private readonly allBlocksCache: TtlCache<Array<Record<string, unknown>>>;
  private readonly rootBlockCache: TtlCache<Record<string, unknown>>;
  private readonly childrenCache: TtlCache<Array<Record<string, unknown>>>;

  constructor(
    private readonly feishuClient: FeishuClient,
    config: AppConfig["feishu"],
  ) {
    this.allBlocksCache = new TtlCache<Array<Record<string, unknown>>>({
      defaultTtlMs: config.docBlocksCacheTtlSeconds * 1000,
      maxEntries: config.cacheMaxEntries,
    });
    this.rootBlockCache = new TtlCache<Record<string, unknown>>({
      defaultTtlMs: config.docBlocksCacheTtlSeconds * 1000,
      maxEntries: Math.max(50, Math.floor(config.cacheMaxEntries / 4)),
    });
    this.childrenCache = new TtlCache<Array<Record<string, unknown>>>({
      defaultTtlMs: config.docBlocksCacheTtlSeconds * 1000,
      maxEntries: config.cacheMaxEntries,
    });
  }

  async getAllBlocks(
    documentId: string,
    pageSize = 500,
  ): Promise<Array<Record<string, unknown>>> {
    const result = await this.getBlocks(documentId, { pageSize });
    return result.blocks;
  }

  async getBlocks(
    documentId: string,
    options: GetDocumentBlocksOptions = {},
  ): Promise<GetDocumentBlocksResult> {
    const normalizedDocumentId = extractDocumentId(documentId);
    if (!normalizedDocumentId) {
      throw new Error("Invalid document ID or document URL.");
    }

    const safePageSize = this.clampPageSize(options.pageSize ?? 500);
    const maxBlocks = this.normalizeOptionalPositiveInt(options.maxBlocks);
    const maxDepth = this.normalizeOptionalDepth(options.maxDepth);

    if (maxBlocks === undefined && maxDepth === undefined) {
      const blocks = await this.allBlocksCache.getOrLoad(
        this.buildAllBlocksCacheKey(normalizedDocumentId),
        () => this.fetchAllBlocks(normalizedDocumentId, safePageSize),
      );
      return {
        blocks,
        truncated: false,
      };
    }

    return this.fetchBlocksBfs(normalizedDocumentId, {
      pageSize: safePageSize,
      maxBlocks,
      maxDepth,
    });
  }

  async getAllChildren(
    documentId: string,
    blockId: string,
    pageSize = 200,
  ): Promise<Array<Record<string, unknown>>> {
    const normalizedDocumentId = extractDocumentId(documentId);
    if (!normalizedDocumentId) {
      throw new Error("Invalid document ID or document URL.");
    }
    const normalizedBlockId = blockId.trim();
    if (!normalizedBlockId) {
      throw new Error("blockId is required.");
    }

    const safePageSize = this.clampPageSize(pageSize);
    return this.childrenCache.getOrLoad(
      this.buildChildrenCacheKey(normalizedDocumentId, normalizedBlockId),
      async () => {
        const items: Array<Record<string, unknown>> = [];
        let pageToken: string | undefined;
        let hasMore = true;

        while (hasMore) {
          const data = await this.feishuClient.request<DocumentBlockChildrenListResponse>(
            `/docx/v1/documents/${normalizedDocumentId}/blocks/${normalizedBlockId}/children`,
            "GET",
            undefined,
            {
              page_size: safePageSize,
              page_token: pageToken,
              document_revision_id: -1,
            },
          );

          if (Array.isArray(data.items) && data.items.length > 0) {
            items.push(...data.items);
          }

          hasMore = Boolean(data.has_more);
          if (hasMore && !data.page_token) {
            throw new Error(
              "Feishu children pagination returned has_more=true without page_token.",
            );
          }
          pageToken = data.page_token;
        }

        return items;
      },
    );
  }

  invalidateDocument(documentId: string): void {
    const normalizedDocumentId = extractDocumentId(documentId);
    if (!normalizedDocumentId) return;
    this.allBlocksCache.delete(this.buildAllBlocksCacheKey(normalizedDocumentId));
    this.rootBlockCache.delete(this.buildRootBlockCacheKey(normalizedDocumentId));
    this.childrenCache.invalidatePrefix(`document-children:${normalizedDocumentId}:`);
  }

  peekChildren(
    documentId: string,
    blockId: string,
  ): Array<Record<string, unknown>> | null {
    const normalizedDocumentId = extractDocumentId(documentId);
    if (!normalizedDocumentId) return null;
    const normalizedBlockId = blockId.trim();
    if (!normalizedBlockId) return null;
    return this.childrenCache.get(
      this.buildChildrenCacheKey(normalizedDocumentId, normalizedBlockId),
    );
  }

  seedChildren(
    documentId: string,
    blockId: string,
    items: Array<Record<string, unknown>>,
  ): void {
    const normalizedDocumentId = extractDocumentId(documentId);
    if (!normalizedDocumentId) return;
    const normalizedBlockId = blockId.trim();
    if (!normalizedBlockId) return;
    this.childrenCache.set(
      this.buildChildrenCacheKey(normalizedDocumentId, normalizedBlockId),
      items,
    );
  }

  cleanupExpired(): number {
    return (
      this.allBlocksCache.cleanupExpired() +
      this.rootBlockCache.cleanupExpired() +
      this.childrenCache.cleanupExpired()
    );
  }

  getCacheStats() {
    return {
      allBlocks: this.allBlocksCache.getStats(),
      rootBlock: this.rootBlockCache.getStats(),
      children: this.childrenCache.getStats(),
    };
  }

  private async fetchAllBlocks(
    normalizedDocumentId: string,
    pageSize: number,
  ): Promise<Array<Record<string, unknown>>> {
    const allItems: Array<Record<string, unknown>> = [];
    let pageToken: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const data = await this.feishuClient.request<DocumentBlockListResponse>(
        `/docx/v1/documents/${normalizedDocumentId}/blocks`,
        "GET",
        undefined,
        {
          page_size: pageSize,
          page_token: pageToken,
          document_revision_id: -1,
        },
      );

      if (Array.isArray(data.items) && data.items.length > 0) {
        allItems.push(...data.items);
      }

      hasMore = Boolean(data.has_more);
      if (hasMore && !data.page_token) {
        throw new Error(
          "Feishu blocks pagination returned has_more=true without page_token.",
        );
      }
      pageToken = data.page_token;
    }

    return allItems;
  }

  private async fetchBlocksBfs(
    normalizedDocumentId: string,
    options: {
      pageSize: number;
      maxBlocks?: number;
      maxDepth?: number;
    },
  ): Promise<GetDocumentBlocksResult> {
    const rootBlock = await this.fetchRootBlock(normalizedDocumentId);
    const blocks: Array<Record<string, unknown>> = [rootBlock];
    const maxBlocks = options.maxBlocks;
    const maxDepth = options.maxDepth;
    let truncated = false;

    if (maxBlocks !== undefined && blocks.length >= maxBlocks) {
      return {
        blocks: blocks.slice(0, maxBlocks),
        truncated: true,
        maxBlocks,
        maxDepth,
      };
    }

    const queue: Array<{ blockId: string; depth: number }> = [
      { blockId: this.extractRequiredBlockId(rootBlock), depth: 0 },
    ];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      if (maxDepth !== undefined && current.depth >= maxDepth) {
        continue;
      }

      const children = await this.getAllChildren(
        normalizedDocumentId,
        current.blockId,
        options.pageSize,
      );

      for (const child of children) {
        blocks.push(child);
        if (
          maxDepth === undefined ||
          current.depth + 1 < maxDepth
        ) {
          const childBlockId = this.extractOptionalBlockId(child);
          if (childBlockId && this.blockHasChildren(child)) {
            queue.push({ blockId: childBlockId, depth: current.depth + 1 });
          }
        }

        if (maxBlocks !== undefined && blocks.length >= maxBlocks) {
          truncated = true;
          return {
            blocks: blocks.slice(0, maxBlocks),
            truncated,
            maxBlocks,
            maxDepth,
          };
        }
      }
    }

    return {
      blocks,
      truncated,
      maxBlocks,
      maxDepth,
    };
  }

  async getRootBlock(documentId: string): Promise<Record<string, unknown>> {
    const normalizedDocumentId = extractDocumentId(documentId);
    if (!normalizedDocumentId) {
      throw new Error("Invalid document ID or document URL.");
    }
    return this.fetchRootBlock(normalizedDocumentId);
  }

  private async fetchRootBlock(documentId: string): Promise<Record<string, unknown>> {
    const cacheKey = this.buildRootBlockCacheKey(documentId);
    return this.rootBlockCache.getOrLoad(cacheKey, async () => {
      const data = await this.feishuClient.request<DocumentBlockListResponse>(
        `/docx/v1/documents/${documentId}/blocks`,
        "GET",
        undefined,
        {
          page_size: 1,
          document_revision_id: -1,
        },
      );
      const rootBlock = Array.isArray(data.items) ? data.items[0] : undefined;
      if (!rootBlock) {
        throw new Error("Document root block not found.");
      }
      return rootBlock;
    });
  }

  private clampPageSize(pageSize: number): number {
    if (!Number.isFinite(pageSize)) return 500;
    return Math.max(1, Math.min(500, Math.floor(pageSize)));
  }

  private buildAllBlocksCacheKey(normalizedDocumentId: string): string {
    return `document-blocks:${normalizedDocumentId}`;
  }

  private buildRootBlockCacheKey(normalizedDocumentId: string): string {
    return `document-root:${normalizedDocumentId}`;
  }

  private buildChildrenCacheKey(
    normalizedDocumentId: string,
    normalizedBlockId: string,
  ): string {
    return `document-children:${normalizedDocumentId}:${normalizedBlockId}`;
  }

  private normalizeOptionalPositiveInt(value?: number): number | undefined {
    if (!Number.isFinite(value)) return undefined;
    const normalized = Math.floor(value as number);
    return normalized > 0 ? normalized : undefined;
  }

  private normalizeOptionalDepth(value?: number): number | undefined {
    if (!Number.isFinite(value)) return undefined;
    const normalized = Math.floor(value as number);
    return normalized >= 0 ? normalized : undefined;
  }

  private blockHasChildren(block: Record<string, unknown>): boolean {
    return Array.isArray(block.children) && block.children.length > 0;
  }

  private extractRequiredBlockId(block: Record<string, unknown>): string {
    const blockId = this.extractOptionalBlockId(block);
    if (!blockId) {
      throw new Error("Block is missing block_id.");
    }
    return blockId;
  }

  private extractOptionalBlockId(block: Record<string, unknown>): string | undefined {
    return typeof block.block_id === "string" && block.block_id.trim()
      ? block.block_id.trim()
      : undefined;
  }
}
