import type { RichTextBlockSpec, RichTextBlockType } from './richTextBlocks.js';

export interface CreateBlockChildrenResponse {
  children?: Array<Record<string, unknown>>;
  document_revision_id?: number;
  client_token?: string;
}

export interface UpdateBlockTextResponse {
  block?: Record<string, unknown>;
  document_revision_id?: number;
}

export interface TextElementStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inline_code?: boolean;
  text_color?: number;
  background_color?: number;
}

export interface TextElementInput {
  text?: string;
  equation?: string;
  style?: TextElementStyle;
}

export interface BatchCreateBlocksInput {
  documentId: string;
  parentBlockId: string;
  children: Array<Record<string, unknown>>;
  index?: number;
  chunkSize?: number;
  minChunkSize?: number;
  adaptiveChunking?: boolean;
  resumeFromCreatedCount?: number;
  checkpointTokenSeed?: string;
  documentRevisionId?: number;
  continueOnError?: boolean;
}

export interface BatchCreateChunkResult {
  chunkIndex: number;
  requestCount: number;
  effectiveChunkSize: number;
  createdCount: number;
  index?: number;
  attempt: number;
  clientToken: string;
  status: 'success' | 'failed';
  retryable?: boolean;
  error?: string;
  documentRevisionId?: number;
}

export interface BatchCreateBlocksResult {
  documentId: string;
  parentBlockId: string;
  totalRequested: number;
  totalCreated: number;
  resumeBaseCreatedCount: number;
  cumulativeCreatedCount: number;
  nextResumeFromCreatedCount: number;
  checkpointTokenSeed?: string;
  adaptiveChunking: boolean;
  targetChunkSize: number;
  minChunkSize: number;
  requestedChunks: number;
  successfulChunks: number;
  failedChunks: number;
  stoppedEarly: boolean;
  createdBlockIds: string[];
  chunks: BatchCreateChunkResult[];
}

export interface ReplaceSectionWithOrderedListInput {
  documentId: string;
  sectionHeading?: string;
  headingPath?: string[];
  items: string[];
  parentBlockId?: string;
  sectionOccurrence?: number;
  pageSize?: number;
  documentRevisionId?: number;
}

export interface ReplaceSectionWithOrderedListResult {
  documentId: string;
  parentBlockId: string;
  sectionHeading: string;
  sectionOccurrence: number;
  insertedCount: number;
  deletedCount: number;
  startIndex: number;
  endIndex: number;
  createdBlockIds: string[];
}

export interface LocateSectionRangeInput {
  documentId: string;
  sectionHeading?: string;
  headingPath?: string[];
  parentBlockId?: string;
  sectionOccurrence?: number;
  pageSize?: number;
}

export interface LocateSectionRangeResult {
  documentId: string;
  parentBlockId: string;
  sectionHeading: string;
  sectionOccurrence: number;
  startIndex: number;
  endIndex: number;
  scannedChildrenCount: number;
  scannedAllChildren: boolean;
}

export interface InsertBeforeHeadingInput {
  documentId: string;
  sectionHeading?: string;
  headingPath?: string[];
  blocks: RichTextBlockSpec[];
  parentBlockId?: string;
  sectionOccurrence?: number;
  pageSize?: number;
  chunkSize?: number;
  minChunkSize?: number;
  adaptiveChunking?: boolean;
  resumeFromCreatedCount?: number;
  checkpointTokenSeed?: string;
  documentRevisionId?: number;
  continueOnError?: boolean;
}

export interface InsertBeforeHeadingResult extends BatchCreateBlocksResult {
  targetHeading: string;
  sectionOccurrence: number;
  insertIndex: number;
  scannedChildrenCount: number;
  scannedAllChildren: boolean;
  typeCounts: Record<RichTextBlockType, number>;
}

export interface ReplaceSectionBlocksInput {
  documentId: string;
  sectionHeading?: string;
  headingPath?: string[];
  blocks: RichTextBlockSpec[];
  parentBlockId?: string;
  sectionOccurrence?: number;
  pageSize?: number;
  chunkSize?: number;
  minChunkSize?: number;
  adaptiveChunking?: boolean;
  resumeFromCreatedCount?: number;
  checkpointTokenSeed?: string;
  documentRevisionId?: number;
  continueOnError?: boolean;
}

export interface ReplaceSectionBlocksResult {
  documentId: string;
  parentBlockId: string;
  sectionHeading: string;
  sectionOccurrence: number;
  insertedCount: number;
  deletedCount: number;
  startIndex: number;
  endIndex: number;
  scannedChildrenCount: number;
  scannedAllChildren: boolean;
  createdBlockIds: string[];
  typeCounts: Record<RichTextBlockType, number>;
}

export interface DeleteByHeadingInput {
  documentId: string;
  sectionHeading?: string;
  headingPath?: string[];
  parentBlockId?: string;
  sectionOccurrence?: number;
  includeHeading?: boolean;
  pageSize?: number;
  documentRevisionId?: number;
}

export interface DeleteByHeadingResult {
  documentId: string;
  parentBlockId: string;
  sectionHeading: string;
  sectionOccurrence: number;
  includeHeading: boolean;
  startIndex: number;
  endIndex: number;
  deletedCount: number;
  scannedChildrenCount: number;
  scannedAllChildren: boolean;
}

export interface UpdateBlockTextInput {
  documentId: string;
  blockId: string;
  textElements: TextElementInput[];
  documentRevisionId?: number;
}

export interface UpdateBlockTextResult {
  documentId: string;
  blockId: string;
  documentRevisionId?: number;
  elementCount: number;
}

export interface BatchUpdateBlockTextItemInput {
  blockId: string;
  textElements: TextElementInput[];
}

export interface BatchUpdateBlockTextInput {
  documentId: string;
  updates: BatchUpdateBlockTextItemInput[];
  documentRevisionId?: number;
  continueOnError?: boolean;
}

export interface BatchUpdateBlockTextItemResult {
  index: number;
  blockId: string;
  status: 'success' | 'failed';
  elementCount?: number;
  documentRevisionId?: number;
  error?: string;
}

export interface BatchUpdateBlockTextResult {
  documentId: string;
  totalRequested: number;
  totalUpdated: number;
  failedCount: number;
  continueOnError: boolean;
  stoppedEarly: boolean;
  results: BatchUpdateBlockTextItemResult[];
}

export interface DeleteDocumentBlocksInput {
  documentId: string;
  parentBlockId: string;
  startIndex: number;
  endIndex: number;
  documentRevisionId?: number;
}

export interface DeleteDocumentBlocksResult {
  documentId: string;
  parentBlockId: string;
  startIndex: number;
  endIndex: number;
  deletedCount: number;
}

export interface GenerateSectionBlocksInput {
  documentId: string;
  parentBlockId?: string;
  index?: number;
  title: string;
  headingLevel?: number;
  paragraphs?: string[];
  orderedItems?: string[];
  bulletItems?: string[];
  chunkSize?: number;
  minChunkSize?: number;
  adaptiveChunking?: boolean;
  resumeFromCreatedCount?: number;
  checkpointTokenSeed?: string;
  documentRevisionId?: number;
  continueOnError?: boolean;
}

export interface GenerateSectionBlocksResult extends BatchCreateBlocksResult {
  sectionTitle: string;
  headingLevel: number;
  paragraphCount: number;
  orderedCount: number;
  bulletCount: number;
}

export interface GenerateRichTextBlocksInput {
  documentId: string;
  parentBlockId?: string;
  index?: number;
  blocks: RichTextBlockSpec[];
  chunkSize?: number;
  minChunkSize?: number;
  adaptiveChunking?: boolean;
  resumeFromCreatedCount?: number;
  checkpointTokenSeed?: string;
  documentRevisionId?: number;
  continueOnError?: boolean;
}

export interface GenerateRichTextBlocksResult extends BatchCreateBlocksResult {
  typeCounts: Record<RichTextBlockType, number>;
}

export interface DeleteDocumentInput {
  documentId: string;
  documentType?: 'document' | 'wiki';
  ignoreNotFound?: boolean;
}

export interface DeleteDocumentResult {
  sourceType: 'document' | 'wiki';
  sourceDocumentId: string;
  deletedDocumentId: string;
  deleted: boolean;
  notFound: boolean;
  deletionMode?: 'browser_delete';
  note?: string;
  taskId?: string;
  postDeleteCheck?: {
    attempted: boolean;
    authType: 'tenant' | 'user';
    verifiedDeleted: boolean;
    notFound: boolean;
    error?: string;
  };
}

export interface BatchDeleteDocumentItemInput {
  documentId: string;
  documentType?: 'document' | 'wiki';
  ignoreNotFound?: boolean;
}

export interface BatchDeleteDocumentItemResult {
  index: number;
  documentId: string;
  documentType?: 'document' | 'wiki';
  status: 'success' | 'failed';
  result?: DeleteDocumentResult;
  error?: string;
}

export interface BatchDeleteDocumentsInput {
  documents: BatchDeleteDocumentItemInput[];
  continueOnError?: boolean;
}

export interface BatchDeleteDocumentsResult {
  totalRequested: number;
  totalSucceeded: number;
  totalDeleted: number;
  notFoundCount: number;
  failedCount: number;
  continueOnError: boolean;
  stoppedEarly: boolean;
  results: BatchDeleteDocumentItemResult[];
}

export interface WikiNodeLookupResponse {
  node?: {
    node_token?: string;
    space_id?: string;
    title?: string;
  };
}

export type { RichTextBlockSpec, RichTextBlockType } from './richTextBlocks.js';
