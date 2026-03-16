import type { NotePlatformDocumentGateway } from "../../platform/index.js";
import type { WikiSpaceService, WikiTreeService } from "../wiki/index.js";

export interface CreateWikiContext {
  spaceId: string;
  parentNodeToken?: string;
}

export interface CreateDocumentInput {
  title: string;
  folderToken?: string;
  wikiContext?: CreateWikiContext;
}

export interface CreateDocumentResult {
  mode: "folder" | "wiki";
  title: string;
  documentId: string;
  url?: string;
  folderToken?: string;
  spaceId?: string;
  nodeToken?: string;
  parentNodeToken?: string;
}

export type CreateFeishuDocumentInput = CreateDocumentInput;
export type CreateFeishuDocumentResult = CreateDocumentResult;

export class DocumentCreateService {
  constructor(
    private readonly documentGateway: NotePlatformDocumentGateway,
    private readonly wikiSpaceService: WikiSpaceService,
    private readonly wikiTreeService: WikiTreeService,
  ) {}

  async createDocument(
    input: CreateDocumentInput,
  ): Promise<CreateDocumentResult> {
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
  ): Promise<CreateDocumentResult> {
    const created = await this.documentGateway.createDocumentInFolder(title, folderToken);

    return {
      mode: "folder",
      title: created.title ?? title,
      documentId: created.documentId,
      url: this.normalizeOptional(created.url),
      folderToken,
    };
  }

  private async createInWiki(
    title: string,
    spaceId: string,
    parentNodeToken?: string,
  ): Promise<CreateDocumentResult> {
    const created = await this.documentGateway.createWikiDocument(
      title,
      spaceId,
      parentNodeToken,
    );

    // Wiki tree/list caches can be stale right after node creation.
    this.wikiSpaceService.invalidateAll();
    this.wikiTreeService.invalidateSpace(spaceId);

    return {
      mode: "wiki",
      title: created.title ?? title,
      documentId: created.documentId,
      url: this.normalizeOptional(created.url),
      spaceId: this.normalizeOptional(created.spaceId) ?? spaceId,
      nodeToken: created.nodeToken,
      parentNodeToken:
        this.normalizeOptional(created.parentNodeToken) ?? parentNodeToken,
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
