import type { AppConfig } from "../config.js";
import type { FeishuClient } from "../feishu/client.js";
import { TtlCache } from "../utils/ttlCache.js";

interface WikiNodeApi {
  node_token?: string;
  parent_node_token?: string;
  title?: string;
  has_child?: boolean;
  obj_type?: string;
  obj_token?: string;
}

interface WikiNodeListResponse {
  items?: WikiNodeApi[];
  has_more?: boolean;
  page_token?: string;
}

export interface WikiTreeNode {
  nodeToken: string;
  parentNodeToken?: string;
  title: string;
  hasChild: boolean;
  objType?: string;
  objToken?: string;
  children: WikiTreeNode[];
}

interface TraversalOptions {
  rootNodeToken?: string;
  pageSize?: number;
  maxDepth?: number;
  maxConcurrency?: number;
}

interface InternalNode {
  nodeToken: string;
  parentNodeToken?: string;
  title: string;
  hasChild: boolean;
  objType?: string;
  objToken?: string;
}

export class WikiTreeService {
  private readonly childNodeCache: TtlCache<InternalNode[]>;
  private readonly treeCache: TtlCache<WikiTreeNode[]>;
  private readonly defaultMaxConcurrency: number;
  private readonly maxAllowedConcurrency: number;

  constructor(
    private readonly feishuClient: FeishuClient,
    config: AppConfig["feishu"],
  ) {
    this.childNodeCache = new TtlCache<InternalNode[]>({
      defaultTtlMs: config.wikiTreeCacheTtlSeconds * 1000,
      maxEntries: Math.max(100, Math.floor(config.cacheMaxEntries / 2)),
    });
    this.treeCache = new TtlCache<WikiTreeNode[]>({
      defaultTtlMs: config.wikiTreeCacheTtlSeconds * 1000,
      maxEntries: Math.max(50, Math.floor(config.cacheMaxEntries / 4)),
    });
    this.maxAllowedConcurrency = Math.max(1, config.maxConcurrency);
    this.defaultMaxConcurrency = this.clampConcurrency(
      config.wikiTreeMaxConcurrency,
    );
  }

  async getTree(spaceId: string, options?: TraversalOptions): Promise<{
    spaceId: string;
    rootNodeToken?: string;
    totalNodes: number;
    tree: WikiTreeNode[];
  }> {
    const normalizedSpaceId = this.normalizeRequired(spaceId, "spaceId");
    const rootNodeToken = this.normalizeOptional(options?.rootNodeToken);
    const pageSize = this.clampPageSize(options?.pageSize);
    const maxDepth = this.clampDepth(options?.maxDepth);
    const maxConcurrency = this.clampConcurrency(options?.maxConcurrency);
    const cacheKey = this.buildTreeCacheKey(
      normalizedSpaceId,
      rootNodeToken,
      pageSize,
      maxDepth,
      maxConcurrency,
    );

    const tree = await this.treeCache.getOrLoad(cacheKey, () =>
      this.buildTree({
        spaceId: normalizedSpaceId,
        rootNodeToken,
        pageSize,
        maxDepth,
        maxConcurrency,
      }),
    );

    return {
      spaceId: normalizedSpaceId,
      rootNodeToken,
      totalNodes: this.countNodes(tree),
      tree,
    };
  }

  invalidateSpace(spaceId: string): number {
    const normalizedSpaceId = this.normalizeOptional(spaceId);
    if (!normalizedSpaceId) return 0;
    let removed = 0;
    removed += this.childNodeCache.invalidatePrefix(`wiki-children:${normalizedSpaceId}:`);
    removed += this.treeCache.invalidatePrefix(`wiki-tree:${normalizedSpaceId}:`);
    return removed;
  }

  cleanupExpired(): number {
    return this.childNodeCache.cleanupExpired() + this.treeCache.cleanupExpired();
  }

  getCacheStats() {
    return {
      childNode: this.childNodeCache.getStats(),
      tree: this.treeCache.getStats(),
    };
  }

  private async buildTree(input: {
    spaceId: string;
    rootNodeToken?: string;
    pageSize: number;
    maxDepth?: number;
    maxConcurrency: number;
  }): Promise<WikiTreeNode[]> {
    const childMap = new Map<string, InternalNode[]>();
    const visitedParents = new Set<string>();
    let parentLayer: string[] = [input.rootNodeToken ?? ""];
    let depth = 0;

    while (parentLayer.length > 0) {
      depth += 1;
      if (input.maxDepth !== undefined && depth > input.maxDepth) {
        break;
      }

      const currentLayer = this.unique(parentLayer).filter((token) => {
        const key = this.parentCacheToken(token);
        if (visitedParents.has(key)) return false;
        visitedParents.add(key);
        return true;
      });

      if (currentLayer.length === 0) {
        break;
      }

      const layerResults = await this.mapLimit(
        currentLayer,
        input.maxConcurrency,
        async (parentNodeToken) => {
          const children = await this.fetchChildren(
            input.spaceId,
            parentNodeToken,
            input.pageSize,
          );
          return { parentNodeToken, children };
        },
      );

      const nextLayer: string[] = [];
      for (const result of layerResults) {
        const parentKey = this.parentCacheToken(result.parentNodeToken);
        childMap.set(parentKey, result.children);
        for (const child of result.children) {
          if (child.hasChild) {
            nextLayer.push(child.nodeToken);
          }
        }
      }
      parentLayer = nextLayer;
    }

    const rootKey = this.parentCacheToken(input.rootNodeToken);
    return this.materializeTree(rootKey, childMap);
  }

  private async fetchChildren(
    spaceId: string,
    parentNodeToken: string,
    pageSize: number,
  ): Promise<InternalNode[]> {
    const parentKey = this.parentCacheToken(parentNodeToken);
    const cacheKey = `wiki-children:${spaceId}:parent=${parentKey}:pageSize=${pageSize}`;
    return this.childNodeCache.getOrLoad(cacheKey, () =>
      this.fetchChildrenFromApi(spaceId, parentNodeToken, pageSize),
    );
  }

  private async fetchChildrenFromApi(
    spaceId: string,
    parentNodeToken: string,
    pageSize: number,
  ): Promise<InternalNode[]> {
    const all: InternalNode[] = [];
    let pageToken: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const data = await this.feishuClient.request<WikiNodeListResponse>(
        `/wiki/v2/spaces/${spaceId}/nodes`,
        "GET",
        undefined,
        {
          page_size: pageSize,
          page_token: pageToken,
          parent_node_token: parentNodeToken || undefined,
        },
      );

      if (Array.isArray(data.items) && data.items.length > 0) {
        for (const item of data.items) {
          const normalized = this.normalizeNode(item);
          if (normalized) {
            all.push(normalized);
          }
        }
      }

      hasMore = Boolean(data.has_more);
      if (hasMore && !data.page_token) {
        throw new Error(
          "Feishu wiki tree pagination returned has_more=true without page_token.",
        );
      }
      pageToken = data.page_token;
    }

    return all;
  }

  private normalizeNode(node: WikiNodeApi): InternalNode | null {
    if (!node.node_token || !node.title) {
      return null;
    }

    return {
      nodeToken: node.node_token,
      parentNodeToken: node.parent_node_token,
      title: node.title,
      hasChild: Boolean(node.has_child),
      objType: node.obj_type,
      objToken: node.obj_token,
    };
  }

  private materializeTree(
    parentKey: string,
    childMap: Map<string, InternalNode[]>,
  ): WikiTreeNode[] {
    const nodes = childMap.get(parentKey) ?? [];
    return nodes.map((node) => ({
      nodeToken: node.nodeToken,
      parentNodeToken: node.parentNodeToken,
      title: node.title,
      hasChild: node.hasChild,
      objType: node.objType,
      objToken: node.objToken,
      children: node.hasChild
        ? this.materializeTree(this.parentCacheToken(node.nodeToken), childMap)
        : [],
    }));
  }

  private countNodes(tree: WikiTreeNode[]): number {
    let count = 0;
    const stack = [...tree];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      count += 1;
      if (node.children.length > 0) {
        stack.push(...node.children);
      }
    }
    return count;
  }

  private async mapLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    if (items.length === 0) return [];
    const results = new Array<R>(items.length);
    let cursor = 0;
    const workerCount = Math.min(Math.max(1, limit), items.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) {
          return;
        }
        results[index] = await fn(items[index], index);
      }
    });
    await Promise.all(workers);
    return results;
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.map((v) => this.normalizeOptional(v) ?? "")));
  }

  private clampPageSize(pageSize?: number): number {
    if (!Number.isFinite(pageSize)) return 50;
    return Math.max(1, Math.min(50, Math.floor(pageSize as number)));
  }

  private clampDepth(maxDepth?: number): number | undefined {
    if (maxDepth === undefined || maxDepth === null) return undefined;
    if (!Number.isFinite(maxDepth)) return undefined;
    return Math.max(1, Math.min(20, Math.floor(maxDepth)));
  }

  private clampConcurrency(maxConcurrency?: number): number {
    if (!Number.isFinite(maxConcurrency)) return this.defaultMaxConcurrency;
    const value = Math.floor(maxConcurrency as number);
    return Math.max(1, Math.min(this.maxAllowedConcurrency, value));
  }

  private parentCacheToken(token?: string): string {
    return this.normalizeOptional(token) ?? "__root__";
  }

  private normalizeRequired(value: string, name: string): string {
    const normalized = this.normalizeOptional(value);
    if (!normalized) {
      throw new Error(`${name} is required.`);
    }
    return normalized;
  }

  private normalizeOptional(value?: string): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
  }

  private buildTreeCacheKey(
    spaceId: string,
    rootNodeToken: string | undefined,
    pageSize: number,
    maxDepth: number | undefined,
    maxConcurrency: number,
  ): string {
    return [
      `wiki-tree:${spaceId}`,
      `root=${this.parentCacheToken(rootNodeToken)}`,
      `pageSize=${pageSize}`,
      `maxDepth=${maxDepth ?? "all"}`,
      `concurrency=${maxConcurrency}`,
    ].join(":");
  }
}
