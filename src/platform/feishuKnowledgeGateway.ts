import type { FeishuClient } from "../feishu/client.js";
import type {
  NoteDocumentSearchPage,
  NotePlatformKnowledgeGateway,
  NoteWikiPage,
} from "./types.js";

interface WikiPageResponse {
  items?: Array<Record<string, unknown>>;
  has_more?: boolean;
  page_token?: string;
}

interface DocumentSearchApiResponse {
  docs_entities?: Array<Record<string, unknown>>;
  has_more?: boolean;
}

export class FeishuNotePlatformKnowledgeGateway
  implements NotePlatformKnowledgeGateway
{
  constructor(private readonly feishuClient: FeishuClient) {}

  async listWikiSpaces(
    options: { pageSize?: number; pageToken?: string } = {},
  ): Promise<NoteWikiPage> {
    const data = await this.feishuClient.request<WikiPageResponse>(
      "/wiki/v2/spaces",
      "GET",
      undefined,
      {
        page_size: options.pageSize,
        page_token: options.pageToken,
      },
    );
    return {
      items: Array.isArray(data.items) ? data.items : [],
      hasMore: Boolean(data.has_more),
      pageToken: data.page_token,
    };
  }

  async listWikiNodes(
    spaceId: string,
    options: {
      parentNodeToken?: string;
      pageSize?: number;
      pageToken?: string;
    } = {},
  ): Promise<NoteWikiPage> {
    const data = await this.feishuClient.request<WikiPageResponse>(
      `/wiki/v2/spaces/${spaceId}/nodes`,
      "GET",
      undefined,
      {
        page_size: options.pageSize,
        page_token: options.pageToken,
        parent_node_token: options.parentNodeToken || undefined,
      },
    );
    return {
      items: Array.isArray(data.items) ? data.items : [],
      hasMore: Boolean(data.has_more),
      pageToken: data.page_token,
    };
  }

  async searchDocuments(options: {
    searchKey: string;
    count: number;
    offset: number;
  }): Promise<NoteDocumentSearchPage> {
    const data = await this.feishuClient.request<DocumentSearchApiResponse>(
      "/suite/docs-api/search/object",
      "POST",
      {
        search_key: options.searchKey,
        docs_types: ["doc"],
        count: options.count,
        offset: options.offset,
      },
    );
    return {
      items: Array.isArray(data.docs_entities) ? data.docs_entities : [],
      hasMore: Boolean(data.has_more),
    };
  }

  async searchWikiNodes(options: {
    query: string;
    pageSize: number;
    pageToken?: string;
  }): Promise<NoteWikiPage> {
    const data = await this.feishuClient.request<WikiPageResponse>(
      "/wiki/v1/nodes/search",
      "POST",
      { query: options.query },
      {
        page_size: options.pageSize,
        page_token: options.pageToken,
      },
    );
    return {
      items: Array.isArray(data.items) ? data.items : [],
      hasMore: Boolean(data.has_more),
      pageToken: data.page_token,
    };
  }
}
