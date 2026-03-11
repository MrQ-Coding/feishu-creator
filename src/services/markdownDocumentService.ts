import { extractDocumentId } from '../feishu/document.js';
import type { DocumentBlockService } from './documentBlockService.js';
import type { DocumentEditService } from './documentEditService.js';
import {
  parseMarkdownToFeishuBlocks,
  renderFeishuBlocksToMarkdown,
} from './markdownCodec.js';

export interface ImportMarkdownInput {
  documentId: string;
  markdown: string;
  parentBlockId?: string;
  index?: number;
  chunkSize?: number;
  minChunkSize?: number;
  adaptiveChunking?: boolean;
  resumeFromCreatedCount?: number;
  checkpointTokenSeed?: string;
  documentRevisionId?: number;
  continueOnError?: boolean;
}

export interface ExportMarkdownInput {
  documentId: string;
  parentBlockId?: string;
}

export class MarkdownDocumentService {
  constructor(
    private readonly documentBlockService: DocumentBlockService,
    private readonly documentEditService: DocumentEditService,
  ) {}

  async importMarkdown(input: ImportMarkdownInput) {
    const normalizedDocumentId = requireDocumentId(input.documentId);
    const markdown = input.markdown?.trim();
    if (!markdown) {
      throw new Error('markdown is required.');
    }

    const parsed = parseMarkdownToFeishuBlocks(markdown);
    const parentBlockId = input.parentBlockId?.trim() || normalizedDocumentId;
    const createResult = await this.documentEditService.batchCreateBlocks({
      documentId: normalizedDocumentId,
      parentBlockId,
      children: parsed.children,
      index: input.index,
      chunkSize: input.chunkSize,
      minChunkSize: input.minChunkSize,
      adaptiveChunking: input.adaptiveChunking,
      resumeFromCreatedCount: input.resumeFromCreatedCount,
      checkpointTokenSeed: input.checkpointTokenSeed,
      documentRevisionId: input.documentRevisionId,
      continueOnError: input.continueOnError,
    });

    return {
      ...createResult,
      markdownLength: markdown.length,
      blockStats: parsed.stats,
    };
  }

  async exportMarkdown(input: ExportMarkdownInput) {
    const normalizedDocumentId = requireDocumentId(input.documentId);
    const parentBlockId =
      input.parentBlockId?.trim() ||
      (await this.documentBlockService.getRootBlock(normalizedDocumentId)).block_id;
    if (typeof parentBlockId !== 'string' || parentBlockId.trim().length === 0) {
      throw new Error('Unable to resolve parentBlockId.');
    }

    const blocks = await this.collectOrderedChildren(normalizedDocumentId, parentBlockId);
    const rendered = renderFeishuBlocksToMarkdown(blocks);

    return {
      documentId: normalizedDocumentId,
      parentBlockId,
      markdown: rendered.markdown,
      markdownLength: rendered.markdown.length,
      exportedBlocks: rendered.stats.exportedBlocks,
      skippedBlocks: rendered.stats.skippedBlocks,
    };
  }

  private async collectOrderedChildren(
    documentId: string,
    parentBlockId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const children = await this.documentBlockService.getAllChildren(documentId, parentBlockId);
    return children;
  }
}

function requireDocumentId(documentId: string): string {
  const normalized = extractDocumentId(documentId);
  if (!normalized) {
    throw new Error('Invalid document ID or document URL.');
  }
  return normalized;
}
