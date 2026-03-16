import type {
  RichTextBuildOptions,
  RichTextBuildResult,
  RichTextBlockSpec,
} from "./feishuRichTextBlocks.js";

export type NoteDocumentType = "document" | "wiki";
export type NoteAuthType = "tenant" | "user";
export type NotePlatformBlockKind =
  | "heading"
  | "text"
  | "ordered"
  | "bullet"
  | "quote"
  | "code"
  | "image"
  | "page"
  | "table"
  | "unknown";

export interface NoteDocumentBlocksPage {
  items: Array<Record<string, unknown>>;
  hasMore: boolean;
  pageToken?: string;
}

export interface NoteDocumentInfoResult {
  document: Record<string, unknown>;
}

export interface NoteWikiInfoResult {
  node: Record<string, unknown> & { obj_token?: string };
}

export interface NoteCreateDocumentResult {
  documentId: string;
  title?: string;
  url?: string;
}

export interface NoteCreateWikiDocumentResult {
  documentId: string;
  nodeToken: string;
  title?: string;
  url?: string;
  spaceId?: string;
  parentNodeToken?: string;
}

export interface NotePlatformDocumentGateway {
  getDocumentInfo(
    documentId: string,
    authTypeOverride?: NoteAuthType,
  ): Promise<NoteDocumentInfoResult>;
  getWikiInfo(
    wikiToken: string,
    authTypeOverride?: NoteAuthType,
  ): Promise<NoteWikiInfoResult>;
  listDocumentBlocks(
    documentId: string,
    options?: {
      pageSize?: number;
      pageToken?: string;
      documentRevisionId?: number;
    },
  ): Promise<NoteDocumentBlocksPage>;
  listBlockChildren(
    documentId: string,
    blockId: string,
    options?: {
      pageSize?: number;
      pageToken?: string;
      documentRevisionId?: number;
    },
  ): Promise<NoteDocumentBlocksPage>;
  createDocumentInFolder(
    title: string,
    folderToken: string,
  ): Promise<NoteCreateDocumentResult>;
  createWikiDocument(
    title: string,
    spaceId: string,
    parentNodeToken?: string,
  ): Promise<NoteCreateWikiDocumentResult>;
}

export interface NoteWikiPage {
  items: Array<Record<string, unknown>>;
  hasMore: boolean;
  pageToken?: string;
}

export interface NoteDocumentSearchPage {
  items: Array<Record<string, unknown>>;
  hasMore: boolean;
}

export interface NotePlatformKnowledgeGateway {
  listWikiSpaces(options?: {
    pageSize?: number;
    pageToken?: string;
  }): Promise<NoteWikiPage>;
  listWikiNodes(
    spaceId: string,
    options?: {
      parentNodeToken?: string;
      pageSize?: number;
      pageToken?: string;
    },
  ): Promise<NoteWikiPage>;
  searchDocuments(options: {
    searchKey: string;
    count: number;
    offset: number;
  }): Promise<NoteDocumentSearchPage>;
  searchWikiNodes(options: {
    query: string;
    pageSize: number;
    pageToken?: string;
  }): Promise<NoteWikiPage>;
}

export interface NoteCreateBlockChildrenResult {
  children: Array<Record<string, unknown>>;
  documentRevisionId?: number;
  clientToken?: string;
}

export interface NoteUpdateBlockTextResult {
  documentRevisionId?: number;
}

export interface NotePlatformEditGateway {
  createBlockChildren(options: {
    documentId: string;
    parentBlockId: string;
    children: Array<Record<string, unknown>>;
    index?: number;
    documentRevisionId?: number;
    clientToken?: string;
  }): Promise<NoteCreateBlockChildrenResult>;
  deleteBlockChildrenRange(options: {
    documentId: string;
    parentBlockId: string;
    startIndex: number;
    endIndex: number;
    documentRevisionId?: number;
    clientToken?: string;
  }): Promise<void>;
  updateBlockText(options: {
    documentId: string;
    blockId: string;
    elements: Array<Record<string, unknown>>;
    documentRevisionId?: number;
  }): Promise<NoteUpdateBlockTextResult>;
}

export interface NoteDownloadedMedia {
  body: Buffer;
  contentType?: string;
  contentDisposition?: string;
}

export interface NoteUploadImageToBlockResult {
  fileToken: string;
  documentRevisionId?: number;
}

export interface NotePlatformMediaGateway {
  downloadMediaByToken(token: string): Promise<NoteDownloadedMedia>;
  uploadImageToBlock(options: {
    documentId: string;
    imageBlockId: string;
    imageBytes: Buffer;
    fileName: string;
    mimeType: string;
    width: number;
    height: number;
    documentRevisionId?: number;
  }): Promise<NoteUploadImageToBlockResult>;
}

export interface NoteMarkdownNestedBlock {
  block: Record<string, unknown>;
  children?: NoteMarkdownNestedBlock[];
  tableRows?: string[][];
}

export interface NoteMarkdownParseStats {
  totalBlocks: number;
  headingCount: number;
  paragraphCount: number;
  orderedCount: number;
  bulletCount: number;
  quoteCount: number;
  codeCount: number;
  tableCount: number;
}

export interface NoteMarkdownParseResult {
  nestedChildren: NoteMarkdownNestedBlock[];
  stats: NoteMarkdownParseStats;
}

export interface NoteMarkdownRenderOptions {
  rootBlockIds?: string[];
}

export interface NoteMarkdownRenderResult {
  markdown: string;
  stats: {
    exportedBlocks: number;
    skippedBlocks: number;
  };
}

export interface NotePlatformImageBlockData {
  token: string;
  width: number;
  height: number;
}

export interface NotePlatformMarkdownGateway {
  parseMarkdownToNestedBlocks(markdown: string): NoteMarkdownParseResult;
  renderBlocksToMarkdown(
    blocks: Array<Record<string, unknown>>,
    options?: NoteMarkdownRenderOptions,
  ): NoteMarkdownRenderResult;
}

export interface NotePlatformProvider {
  readonly id: string;
  extractDocumentId(input: string): string | null;
  extractWikiToken(input: string): string | null;
  detectDocumentType(input: string): NoteDocumentType;
  extractBlockType(block: Record<string, unknown>): number | undefined;
  extractBlockKind(block: Record<string, unknown>): NotePlatformBlockKind;
  extractBlockId(block: Record<string, unknown>): string | undefined;
  extractChildIds(block: Record<string, unknown>): string[];
  extractHeadingLevel(block: Record<string, unknown>): number | undefined;
  extractBlockText(block: Record<string, unknown>): string;
  sanitizeBlockForCopy(block: Record<string, unknown>): Record<string, unknown>;
  extractImageBlockData(block: Record<string, unknown>): NotePlatformImageBlockData;
  buildRichTextChildren(
    blocks: RichTextBlockSpec[],
    options: RichTextBuildOptions,
  ): RichTextBuildResult;
  buildHeadingBlock(level: number, text: string): Record<string, unknown>;
  buildTextBlock(text: string): Record<string, unknown>;
  buildOrderedBlock(text: string): Record<string, unknown>;
  buildBulletBlock(text: string): Record<string, unknown>;
  buildTableBlock(rowSize: number, columnSize: number): Record<string, unknown>;
  buildImageBlock(width: number, height: number): Record<string, unknown>;
}
