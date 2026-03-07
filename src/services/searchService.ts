import type { FeishuClient } from "../feishu/client.js";

export type SearchType = "document" | "wiki" | "both";
type AuthType = "tenant" | "user";

interface SearchInput {
  searchKey: string;
  searchType?: SearchType;
  offset?: number;
  pageToken?: string;
  spaceId?: string;
  authType: AuthType;
}

interface DocumentSearchApiResponse {
  docs_entities?: Array<Record<string, unknown>>;
  has_more?: boolean;
}

interface WikiSearchApiResponse {
  items?: Array<Record<string, unknown>>;
  has_more?: boolean;
  page_token?: string;
}

interface SearchPageGuide {
  hasMore: boolean;
  description: string;
  nextPageParams?: Record<string, unknown>;
}

export interface StandardSearchItem {
  sourceType: "document" | "wiki";
  title?: string;
  documentId?: string;
  docsToken?: string;
  docsType?: string;
  ownerId?: string;
  url?: string;
  nodeToken?: string;
  objToken?: string;
  objType?: string;
  spaceId?: string;
  openId?: string;
  raw: Record<string, unknown>;
}

export interface SearchResult {
  requestedSearchType: SearchType;
  effectiveSearchType: SearchType;
  documents?: StandardSearchItem[];
  wikis?: StandardSearchItem[];
  paginationGuide: SearchPageGuide;
}

export class SearchService {
  private static readonly MAX_TOTAL_RESULTS = 100;
  private static readonly DOCUMENT_PAGE_SIZE = 50;
  private static readonly WIKI_PAGE_SIZE = 20;

  constructor(private readonly feishuClient: FeishuClient) {}

  async search(input: SearchInput): Promise<SearchResult> {
    const searchKey = this.normalizeRequired(input.searchKey, "searchKey");
    const requestedSearchType = input.searchType ?? "both";
    const requestedOffset = this.clampNonNegative(input.offset, 0);
    const requestedPageToken = this.normalizeOptional(input.pageToken);
    const requestedSpaceId = this.normalizeOptional(input.spaceId);

    const effectiveSearchType =
      input.authType === "tenant" &&
      (requestedSearchType === "wiki" || requestedSearchType === "both")
        ? "document"
        : requestedSearchType;

    const documents: StandardSearchItem[] = [];
    const wikis: StandardSearchItem[] = [];

    let nextOffset = requestedOffset;
    let documentHasMore = false;
    let nextWikiPageToken: string | undefined;
    let wikiHasMore = false;

    if (effectiveSearchType === "document" || effectiveSearchType === "both") {
      const documentResult = await this.searchDocuments(
        searchKey,
        SearchService.MAX_TOTAL_RESULTS,
        requestedOffset,
      );
      documents.push(...this.filterAndSortItems(documentResult.items, searchKey));
      nextOffset = documentResult.nextOffset;
      documentHasMore = documentResult.hasMore;
    }

    if (effectiveSearchType === "wiki" || effectiveSearchType === "both") {
      const remaining = SearchService.MAX_TOTAL_RESULTS - documents.length;
      if (remaining > 0) {
        const wikiResult = await this.searchWikiNodes(
          searchKey,
          remaining,
          requestedPageToken,
        );
        wikis.push(
          ...this.filterAndSortItems(wikiResult.items, searchKey, requestedSpaceId),
        );
        nextWikiPageToken = wikiResult.nextPageToken;
        wikiHasMore = wikiResult.hasMore;
      } else {
        wikiHasMore = true;
      }
    }

    const paginationGuide = this.buildPaginationGuide({
      effectiveSearchType,
      documentHasMore,
      wikiHasMore,
      nextOffset,
      nextWikiPageToken,
    });

    const result: SearchResult = {
      requestedSearchType,
      effectiveSearchType,
      paginationGuide,
    };
    if (effectiveSearchType === "document" || effectiveSearchType === "both") {
      result.documents = documents;
    }
    if (effectiveSearchType === "wiki" || effectiveSearchType === "both") {
      result.wikis = wikis;
    }

    return result;
  }

  private async searchDocuments(
    searchKey: string,
    maxItems: number,
    offset: number,
  ): Promise<{
    items: StandardSearchItem[];
    hasMore: boolean;
    nextOffset: number;
  }> {
    const items: StandardSearchItem[] = [];
    let currentOffset = offset;
    let hasMore = true;

    while (hasMore && items.length < maxItems) {
      const data = await this.feishuClient.request<DocumentSearchApiResponse>(
        "/suite/docs-api/search/object",
        "POST",
        {
          search_key: searchKey,
          docs_types: ["doc"],
          count: SearchService.DOCUMENT_PAGE_SIZE,
          offset: currentOffset,
        },
      );

      const pageItems = Array.isArray(data.docs_entities) ? data.docs_entities : [];
      items.push(...pageItems.map((item) => this.standardizeDocumentItem(item)));
      currentOffset += pageItems.length;
      hasMore = Boolean(data.has_more) && pageItems.length > 0;

      if (items.length >= maxItems) {
        break;
      }
    }

    return {
      items: items.slice(0, maxItems),
      hasMore,
      nextOffset: currentOffset,
    };
  }

  private async searchWikiNodes(
    query: string,
    maxItems: number,
    pageToken?: string,
  ): Promise<{
    items: StandardSearchItem[];
    hasMore: boolean;
    nextPageToken?: string;
  }> {
    const items: StandardSearchItem[] = [];
    let currentPageToken = pageToken;
    let hasMore = true;

    while (hasMore && items.length < maxItems) {
      const pageSize = Math.min(SearchService.WIKI_PAGE_SIZE, maxItems - items.length);
      const data = await this.feishuClient.request<WikiSearchApiResponse>(
        "/wiki/v1/nodes/search",
        "POST",
        { query },
        {
          page_size: pageSize,
          page_token: currentPageToken,
        },
      );

      const pageItems = Array.isArray(data.items) ? data.items : [];
      items.push(...pageItems.map((item) => this.standardizeWikiItem(item)));
      currentPageToken = this.normalizeOptional(data.page_token);
      hasMore = Boolean(data.has_more) && pageItems.length > 0;

      if (items.length >= maxItems) {
        break;
      }
    }

    return {
      items: items.slice(0, maxItems),
      hasMore,
      nextPageToken: currentPageToken,
    };
  }

  private buildPaginationGuide(input: {
    effectiveSearchType: SearchType;
    documentHasMore: boolean;
    wikiHasMore: boolean;
    nextOffset: number;
    nextWikiPageToken?: string;
  }): SearchPageGuide {
    const hasMore = input.documentHasMore || input.wikiHasMore;
    if (!hasMore) {
      return {
        hasMore: false,
        description: "No more results.",
      };
    }

    if (input.effectiveSearchType === "document" && input.documentHasMore) {
      return {
        hasMore: true,
        description:
          "Call search_feishu_documents with searchType=document and the returned offset for next page.",
        nextPageParams: {
          searchType: "document",
          offset: input.nextOffset,
        },
      };
    }

    if (
      input.effectiveSearchType === "wiki" &&
      input.wikiHasMore &&
      input.nextWikiPageToken
    ) {
      return {
        hasMore: true,
        description:
          "Call search_feishu_documents with searchType=wiki and the returned pageToken for next page.",
        nextPageParams: {
          searchType: "wiki",
          pageToken: input.nextWikiPageToken,
        },
      };
    }

    if (input.documentHasMore) {
      return {
        hasMore: true,
        description:
          "Call search_feishu_documents with searchType=both and the returned offset for the next page of documents.",
        nextPageParams: {
          searchType: "both",
          offset: input.nextOffset,
        },
      };
    }

    if (input.wikiHasMore && input.nextWikiPageToken) {
      return {
        hasMore: true,
        description:
          "Call search_feishu_documents with searchType=wiki and the returned pageToken for next page of wiki nodes.",
        nextPageParams: {
          searchType: "wiki",
          pageToken: input.nextWikiPageToken,
        },
      };
    }

    return {
      hasMore: true,
      description: "More results may be available, but next-page token is missing.",
    };
  }

  private standardizeDocumentItem(item: Record<string, unknown>): StandardSearchItem {
    return {
      sourceType: "document",
      title: this.pickString(item, ["title", "name"]),
      documentId: this.pickString(item, ["docs_token", "document_id", "obj_token"]),
      docsToken: this.pickString(item, ["docs_token"]),
      docsType: this.pickString(item, ["docs_type", "type"]),
      ownerId: this.pickString(item, ["owner_id"]),
      url: this.pickString(item, ["url", "obj_url", "open_url"]),
      raw: item,
    };
  }

  private standardizeWikiItem(item: Record<string, unknown>): StandardSearchItem {
    return {
      sourceType: "wiki",
      title: this.pickString(item, ["title", "name"]),
      documentId: this.pickString(item, ["obj_token", "document_id"]),
      nodeToken: this.pickString(item, ["node_token", "node_id"]),
      objToken: this.pickString(item, ["obj_token"]),
      objType: this.pickStringOrNumber(item, ["obj_type"]),
      spaceId: this.pickString(item, ["space_id"]),
      openId: this.pickString(item, ["open_id"]),
      ownerId: this.pickString(item, ["owner_id"]),
      url: this.pickString(item, ["url", "node_url", "obj_url", "open_url"]),
      raw: item,
    };
  }

  private pickString(
    source: Record<string, unknown>,
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return undefined;
  }

  private pickStringOrNumber(
    source: Record<string, unknown>,
    keys: string[],
  ): string | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }
    }
    return undefined;
  }

  private filterAndSortItems(
    items: StandardSearchItem[],
    searchKey: string,
    spaceId?: string,
  ): StandardSearchItem[] {
    const normalizedSearchKey = searchKey.trim().toLowerCase();
    const filtered = spaceId
      ? items.filter(
          (item) => item.sourceType !== "wiki" || item.spaceId === spaceId,
        )
      : items;

    return [...filtered].sort((a, b) => {
      const scoreDelta =
        this.computeSearchScore(a.title, normalizedSearchKey) -
        this.computeSearchScore(b.title, normalizedSearchKey);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      const aTitle = a.title ?? "";
      const bTitle = b.title ?? "";
      if (aTitle.length !== bTitle.length) {
        return aTitle.length - bTitle.length;
      }
      return aTitle.localeCompare(bTitle);
    });
  }

  private computeSearchScore(title: string | undefined, searchKey: string): number {
    const normalizedTitle = title?.trim().toLowerCase() ?? "";
    if (!normalizedTitle) return 99;
    if (normalizedTitle === searchKey) return 0;
    if (normalizedTitle.startsWith(searchKey)) return 1;
    if (normalizedTitle.includes(searchKey)) return 2;
    return 3;
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

  private clampNonNegative(value: number | undefined, defaultValue: number): number {
    if (!Number.isFinite(value)) return defaultValue;
    return Math.max(0, Math.floor(value as number));
  }
}
