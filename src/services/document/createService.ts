import type { FeishuClient } from "../../feishu/client.js";
import type { WikiSpaceService, WikiTreeService } from "../wiki/index.js";

export interface CreateWikiContext {
  spaceId: string;
  parentNodeToken?: string;
}

export interface CreateFeishuDocumentInput {
  title: string;
  folderToken?: string;
  wikiContext?: CreateWikiContext;
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
    obj_type?: string;
    url?: string;
  };
}

export interface CreateFeishuDocumentResult {
  mode: "folder" | "wiki";
  title: string;
  documentId: string;
  url?: string;
  folderToken?: string;
  spaceId?: string;
  nodeToken?: string;
  parentNodeToken?: string;
}

export class DocumentCreateService {
  constructor(
    private readonly feishuClient: FeishuClient,
    private readonly wikiSpaceService: WikiSpaceService,
    private readonly wikiTreeService: WikiTreeService,
  ) {}

  async createDocument(
    input: CreateFeishuDocumentInput,
  ): Promise<CreateFeishuDocumentResult> {
    const title = this.normalizeRequired(input.title, "title");
    const folderToken = this.normalizeOptional(input.folderToken);
    const wikiContext = input.wikiContext;

    if (folderToken && wikiContext) {
      throw new Error(
        "Cannot provide both folderToken and wikiContext. Choose exactly one mode.",
      );
    }
    if (!folderToken && !wikiContext) {
      throw new Error("Either folderToken or wikiContext is required.");
    }

    if (folderToken) {
      return this.createInFolder(title, folderToken);
    }

    const spaceId = this.normalizeRequired(wikiContext?.spaceId, "wikiContext.spaceId");
    const parentNodeToken = this.normalizeOptional(wikiContext?.parentNodeToken);
    return this.createInWiki(title, spaceId, parentNodeToken);
  }

  private async createInFolder(
    title: string,
    folderToken: string,
  ): Promise<CreateFeishuDocumentResult> {
    const data = await this.feishuClient.request<CreateDocumentApiResponse>(
      "/docx/v1/documents",
      "POST",
      {
        title,
        folder_token: folderToken,
      },
    );

    const documentId = this.normalizeRequired(
      data.document?.document_id,
      "document.document_id",
    );

    return {
      mode: "folder",
      title: data.document?.title ?? title,
      documentId,
      url: this.normalizeOptional(data.document?.url),
      folderToken,
    };
  }

  private async createInWiki(
    title: string,
    spaceId: string,
    parentNodeToken?: string,
  ): Promise<CreateFeishuDocumentResult> {
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

    const nodeToken = this.normalizeRequired(data.node?.node_token, "node.node_token");
    const documentId = this.normalizeRequired(data.node?.obj_token, "node.obj_token");

    // Wiki tree/list caches can be stale right after node creation.
    this.wikiSpaceService.invalidateAll();
    this.wikiTreeService.invalidateSpace(spaceId);

    return {
      mode: "wiki",
      title: data.node?.title ?? title,
      documentId,
      url: this.normalizeOptional(data.node?.url),
      spaceId: this.normalizeOptional(data.node?.space_id) ?? spaceId,
      nodeToken,
      parentNodeToken:
        this.normalizeOptional(data.node?.parent_node_token) ?? parentNodeToken,
    };
  }

  private normalizeRequired(value: unknown, field: string): string {
    const normalized = this.normalizeOptional(value);
    if (!normalized) {
      throw new Error(`${field} is required.`);
    }
    return normalized;
  }

  private normalizeOptional(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
}
