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

export interface UploadLocalImageInput {
  documentId: string;
  imagePath: string;
  parentBlockId?: string;
  replaceBlockId?: string;
  index?: number;
  fileName?: string;
  width?: number;
  height?: number;
  documentRevisionId?: number;
}

export interface UploadLocalImageResult {
  documentId: string;
  mode: 'insert' | 'replace';
  imageBlockId: string;
  parentBlockId?: string;
  replaceBlockId?: string;
  index?: number;
  imagePath: string;
  fileName: string;
  mimeType: string;
  fileToken: string;
  size: number;
  width: number;
  height: number;
  documentRevisionId?: number;
}

export interface TableSizeInput {
  rowSize?: number;
  columnSize?: number;
  cells?: string[][];
}

export interface CreateTableInput extends TableSizeInput {
  documentId: string;
  parentBlockId?: string;
  index?: number;
  documentRevisionId?: number;
}

export interface TableMergeInfo {
  rowSpan?: number;
  colSpan?: number;
}

export interface TableCellRef {
  rowIndex: number;
  columnIndex: number;
  cellBlockId: string;
  text: string;
  mergeInfo?: TableMergeInfo;
}

export interface TableSnapshot {
  rowSize: number;
  columnSize: number;
  cells: string[][];
  cellBlockIds: string[][];
  mergeInfo?: Record<string, TableMergeInfo>;
}

export interface CreateTableResult extends TableSnapshot {
  documentId: string;
  parentBlockId: string;
  index?: number;
  tableBlockId: string;
  filledCellCount: number;
}

export interface GetTableInput {
  documentId: string;
  tableBlockId: string;
}

export interface GetTableResult extends TableSnapshot {
  documentId: string;
  tableBlockId: string;
  parentBlockId?: string;
  tableIndex?: number;
}

export interface UpdateTableCellInput {
  documentId: string;
  tableBlockId: string;
  rowIndex: number;
  columnIndex: number;
  text: string;
  documentRevisionId?: number;
}

export interface UpdateTableCellResult {
  documentId: string;
  tableBlockId: string;
  rowIndex: number;
  columnIndex: number;
  cellBlockId: string;
  text: string;
  clearedBlockCount: number;
  createdBlockIds: string[];
}

export interface ReplaceTableInput extends TableSizeInput {
  documentId: string;
  tableBlockId: string;
  documentRevisionId?: number;
}

export interface ReplaceTableResult extends TableSnapshot {
  documentId: string;
  originalTableBlockId: string;
  tableBlockId: string;
  parentBlockId: string;
  tableIndex: number;
  recreated: boolean;
  filledCellCount: number;
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

export type PreviewEditOperation =
  | 'insert_before_heading'
  | 'replace_section_blocks'
  | 'replace_section_with_ordered_list'
  | 'delete_by_heading'
  | 'copy_section'
  | 'move_section';

export interface PreviewBlockSummary {
  blockId?: string;
  index: number;
  blockType:
    | number
    | 'heading'
    | 'text'
    | 'ordered'
    | 'bullet'
    | 'quote'
    | 'code'
    | 'image'
    | 'page'
    | 'unknown';
  textPreview: string;
  hasChildren: boolean;
  childCount: number;
}

export interface PreviewCreateBlockSummary {
  position: number;
  blockType: RichTextBlockType | 'image' | 'page' | 'unknown' | number;
  textPreview: string;
  headingLevel?: number;
  codeLanguage?: number;
  codeWrap?: boolean;
}

export interface PreviewLocateTarget {
  documentId: string;
  parentBlockId: string;
  sectionHeading: string;
  sectionOccurrence: number;
  headingIndex: number;
  startIndex: number;
  endIndex: number;
  scannedChildrenCount: number;
  scannedAllChildren: boolean;
}

export interface PreviewInsertionTarget {
  documentId: string;
  parentBlockId: string;
  insertIndex: number;
  mode: 'before_heading' | 'explicit_index' | 'append';
  anchorHeading?: string;
}

export interface PreviewCreatePlan {
  documentId: string;
  parentBlockId: string;
  insertIndex: number;
  blockCount: number;
  typeCounts?: Partial<Record<RichTextBlockType, number>>;
  topLevelBlockCount?: number;
  estimatedCopiedBlockCount?: number;
  blocks: PreviewCreateBlockSummary[];
}

export interface PreviewDeletePlan {
  documentId: string;
  parentBlockId: string;
  startIndex: number;
  endIndex: number;
  deletedCount: number;
  blocks: PreviewBlockSummary[];
  includeHeading?: boolean;
  currentRangeStartIndex?: number;
  currentRangeEndIndex?: number;
  note?: string;
}

export interface PreviewEditPlanInput extends SectionCopyTargetInput {
  documentId: string;
  operation: PreviewEditOperation;
  sectionHeading?: string;
  headingPath?: string[];
  parentBlockId?: string;
  sectionOccurrence?: number;
  pageSize?: number;
  blocks?: RichTextBlockSpec[];
  items?: string[];
  includeHeading?: boolean;
}

export interface PreviewEditPlanResult {
  dryRun: true;
  operation: PreviewEditOperation;
  summary: string;
  source?: PreviewLocateTarget;
  target?: PreviewLocateTarget | PreviewInsertionTarget;
  createPlan?: PreviewCreatePlan;
  deletePlan?: PreviewDeletePlan;
  warnings: string[];
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

export interface UpsertSectionInput {
  documentId: string;
  sectionHeading?: string;
  headingPath?: string[];
  blocks: RichTextBlockSpec[];
  parentBlockId?: string;
  sectionOccurrence?: number;
  pageSize?: number;
  headingLevel?: number;
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

export interface UpsertSectionResult {
  documentId: string;
  parentBlockId: string;
  mode: 'updated' | 'created';
  sectionHeading: string;
  sectionOccurrence: number;
  insertedCount: number;
  deletedCount: number;
  insertIndex: number;
  startIndex: number;
  endIndex: number;
  scannedChildrenCount: number;
  scannedAllChildren: boolean;
  headingLevel?: number;
  headingBlockId?: string;
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

export interface SectionCopyTargetInput {
  targetDocumentId?: string;
  targetParentBlockId?: string;
  targetIndex?: number;
  targetSectionHeading?: string;
  targetHeadingPath?: string[];
  targetSectionOccurrence?: number;
  targetPageSize?: number;
  targetDocumentRevisionId?: number;
  chunkSize?: number;
  minChunkSize?: number;
  adaptiveChunking?: boolean;
}

export interface CopySectionInput extends SectionCopyTargetInput {
  documentId: string;
  sectionHeading?: string;
  headingPath?: string[];
  parentBlockId?: string;
  sectionOccurrence?: number;
  pageSize?: number;
}

export interface CopySectionResult {
  sourceDocumentId: string;
  sourceParentBlockId: string;
  sourceSectionHeading: string;
  sourceSectionOccurrence: number;
  sourceStartIndex: number;
  sourceEndIndex: number;
  targetDocumentId: string;
  targetParentBlockId: string;
  targetAnchorHeading?: string;
  insertIndex: number;
  topLevelBlockCount: number;
  copiedBlockCount: number;
  createdBlockIds: string[];
}

export interface MoveSectionInput extends CopySectionInput {}

export interface MoveSectionResult extends CopySectionResult {
  deletedCount: number;
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
