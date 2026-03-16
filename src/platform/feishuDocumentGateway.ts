import type { FeishuClient } from "../feishu/client.js";
import type {
  NoteAuthType,
  NoteCreateDocumentResult,
  NoteCreateWikiDocumentResult,
  NoteDocumentBlocksPage,
  NoteDocumentInfoResult,
  NotePlatformDocumentGateway,
  NoteWikiInfoResult,
} from "./types.js";

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

interface CreateDocumentApiResponse {
  document?: {
    document_id?: string;
    title?: string;
    url?: string;
  };
}

interface CreateWikiNodeApiResponse {
  node?: {
    title?: string;
    space_id?: string;
    node_token?: string;
    parent_node_token?: string;
    obj_token?: string;
    url?: string;
  };
}

export class FeishuNotePlatformDocumentGateway
  implements NotePlatformDocumentGateway
{
  constructor(private readonly feishuClient: FeishuClient) {}

  async getDocumentInfo(
    documentId: string,
    authTypeOverride?: NoteAuthType,
  ): Promise<NoteDocumentInfoResult> {
    const document = await this.feishuClient.request<Record<string, unknown>>(
      `/docx/v1/documents/${documentId}`,
      "GET",
      undefined,
      undefined,
      { authTypeOverride },
    );
    return { document };
  }

  async getWikiInfo(
    wikiToken: string,
    authTypeOverride?: NoteAuthType,
  ): Promise<NoteWikiInfoResult> {
    const data = await this.feishuClient.request<{
      node?: Record<string, unknown> & { obj_token?: string };
    }>(
      "/wiki/v2/spaces/get_node",
      "GET",
      undefined,
      {
        token: wikiToken,
        obj_type: "wiki",
      },
      { authTypeOverride },
    );
    if (!data.node) {
      throw new Error("Wiki node response missing node.");
    }
    return { node: data.node };
  }

  async listDocumentBlocks(
    documentId: string,
    options: {
      pageSize?: number;
      pageToken?: string;
      documentRevisionId?: number;
    } = {},
  ): Promise<NoteDocumentBlocksPage> {
    const data = await this.feishuClient.request<DocumentBlockListResponse>(
      `/docx/v1/documents/${documentId}/blocks`,
      "GET",
      undefined,
      {
        page_size: options.pageSize,
        page_token: options.pageToken,
        document_revision_id: options.documentRevisionId ?? -1,
      },
    );
    return {
      items: Array.isArray(data.items) ? data.items : [],
      hasMore: Boolean(data.has_more),
      pageToken: data.page_token,
    };
  }

  async listBlockChildren(
    documentId: string,
    blockId: string,
    options: {
      pageSize?: number;
      pageToken?: string;
      documentRevisionId?: number;
    } = {},
  ): Promise<NoteDocumentBlocksPage> {
    const data = await this.feishuClient.request<DocumentBlockChildrenListResponse>(
      `/docx/v1/documents/${documentId}/blocks/${blockId}/children`,
      "GET",
      undefined,
      {
        page_size: options.pageSize,
        page_token: options.pageToken,
        document_revision_id: options.documentRevisionId ?? -1,
      },
    );
    return {
      items: Array.isArray(data.items) ? data.items : [],
      hasMore: Boolean(data.has_more),
      pageToken: data.page_token,
    };
  }

  async createDocumentInFolder(
    title: string,
    folderToken: string,
  ): Promise<NoteCreateDocumentResult> {
    const data = await this.feishuClient.request<CreateDocumentApiResponse>(
      "/docx/v1/documents",
      "POST",
      {
        title,
        folder_token: folderToken,
      },
    );

    const documentId = data.document?.document_id?.trim();
    if (!documentId) {
      throw new Error("document.document_id is required.");
    }

    return {
      documentId,
      title: data.document?.title,
      url: data.document?.url,
    };
  }

  async createWikiDocument(
    title: string,
    spaceId: string,
    parentNodeToken?: string,
  ): Promise<NoteCreateWikiDocumentResult> {
    const payload: Record<string, unknown> = {
      title,
      obj_type: "docx",
      node_type: "origin",
    };
    if (parentNodeToken) {
      payload.parent_node_token = parentNodeToken;
    }

    const data = await this.feishuClient.request<CreateWikiNodeApiResponse>(
      `/wiki/v2/spaces/${spaceId}/nodes`,
      "POST",
      payload,
    );

    const nodeToken = data.node?.node_token?.trim();
    if (!nodeToken) {
      throw new Error("node.node_token is required.");
    }
    const documentId = data.node?.obj_token?.trim();
    if (!documentId) {
      throw new Error("node.obj_token is required.");
    }

    return {
      documentId,
      nodeToken,
      title: data.node?.title,
      url: data.node?.url,
      spaceId: data.node?.space_id,
      parentNodeToken: data.node?.parent_node_token,
    };
  }
}
