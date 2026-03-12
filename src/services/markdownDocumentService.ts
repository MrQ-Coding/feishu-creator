import { extractDocumentId } from '../feishu/document.js';
import type { DocumentBlockService } from './documentBlockService.js';
import type { DocumentEditService } from './documentEditService.js';
import {
  parseMarkdownToNestedBlocks,
  renderFeishuBlocksToMarkdown,
} from './markdownCodec.js';
import type { NestedFeishuBlock } from './markdownCodec.js';
import { buildTextBlock } from './documentEdit/richTextBlocks.js';

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

    const parsed = parseMarkdownToNestedBlocks(markdown);
    const parentBlockId = input.parentBlockId?.trim() || normalizedDocumentId;

    // Extract top-level block payloads for the initial batch create.
    const topLevelBlocks = parsed.nestedChildren.map((n) => n.block);

    const createResult = await this.documentEditService.batchCreateBlocks({
      documentId: normalizedDocumentId,
      parentBlockId,
      children: topLevelBlocks,
      index: input.index,
      chunkSize: input.chunkSize,
      minChunkSize: input.minChunkSize,
      adaptiveChunking: input.adaptiveChunking,
      resumeFromCreatedCount: input.resumeFromCreatedCount,
      checkpointTokenSeed: input.checkpointTokenSeed,
      documentRevisionId: input.documentRevisionId,
      continueOnError: input.continueOnError,
    });

    // Phase 2: Recursively create nested children (sub-list items).
    const createdIds = createResult.createdBlockIds ?? [];
    let nestedCreatedCount = 0;
    let failedTableCells = 0;

    for (let i = 0; i < parsed.nestedChildren.length && i < createdIds.length; i++) {
      const nestedItem = parsed.nestedChildren[i];
      const parentId = createdIds[i];

      // Handle nested list children
      if (nestedItem.children && nestedItem.children.length > 0) {
        nestedCreatedCount += await this.createNestedChildren(
          normalizedDocumentId,
          parentId,
          nestedItem.children,
          input,
        );
      }

      // Handle table cell filling
      if (nestedItem.tableRows && nestedItem.tableRows.length > 0) {
        failedTableCells += await this.fillTableCells(
          normalizedDocumentId,
          parentId,
          nestedItem.tableRows,
        );
      }
    }

    return {
      ...createResult,
      totalCreated: createResult.totalCreated + nestedCreatedCount,
      markdownLength: markdown.length,
      blockStats: parsed.stats,
      failedTableCells,
    };
  }

  private async createNestedChildren(
    documentId: string,
    parentBlockId: string,
    children: NestedFeishuBlock[],
    input: ImportMarkdownInput,
  ): Promise<number> {
    const childBlocks = children.map((c) => c.block);

    const result = await this.documentEditService.batchCreateBlocks({
      documentId,
      parentBlockId,
      children: childBlocks,
      chunkSize: input.chunkSize,
      minChunkSize: input.minChunkSize,
      adaptiveChunking: input.adaptiveChunking,
      continueOnError: input.continueOnError,
    });

    let totalCreated = result.totalCreated;
    const createdIds = result.createdBlockIds ?? [];

    // Recurse for deeper nesting levels.
    for (let i = 0; i < children.length && i < createdIds.length; i++) {
      const child = children[i];
      if (child.children && child.children.length > 0) {
        totalCreated += await this.createNestedChildren(
          documentId,
          createdIds[i],
          child.children,
          input,
        );
      }
    }

    return totalCreated;
  }

  private async fillTableCells(
    documentId: string,
    tableBlockId: string,
    rows: string[][],
  ): Promise<number> {
    let failedCells = 0;
    // After creating a table block, Feishu auto-generates cell blocks as children.
    // We fetch the table block's children to get cell IDs, then fill each cell.
    try {
      const children = await this.documentBlockService.getAllChildren(
        documentId,
        tableBlockId,
      );

      // Cell blocks are the direct children of the table block.
      const cellIds = children
        .map((child) => typeof child.block_id === 'string' ? child.block_id : '')
        .filter((id) => id.length > 0);

      if (cellIds.length === 0) return 0;

      const colSize = rows[0]?.length ?? 0;
      if (colSize === 0) return 0;

      // Fill each cell with its text content.
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < colSize; c++) {
          const cellIndex = r * colSize + c;
          const cellId = cellIds[cellIndex];
          const cellText = rows[r]?.[c] ?? '';
          if (!cellId || !cellText) continue;

          try {
            await this.documentEditService.batchCreateBlocks({
              documentId,
              parentBlockId: cellId,
              children: [buildTextBlock(cellText)],
            });
          } catch {
            failedCells += 1;
          }
        }
      }
    } catch {
      for (const row of rows) {
        for (const cellText of row) {
          if (cellText && cellText.trim().length > 0) {
            failedCells += 1;
          }
        }
      }
    }
    return failedCells;
  }

  async exportMarkdown(input: ExportMarkdownInput) {
    const normalizedDocumentId = requireDocumentId(input.documentId);
    const parentBlockId =
      input.parentBlockId?.trim() ||
      (await this.documentBlockService.getRootBlock(normalizedDocumentId)).block_id;
    if (typeof parentBlockId !== 'string' || parentBlockId.trim().length === 0) {
      throw new Error('Unable to resolve parentBlockId.');
    }

    const { blocks, rootBlockIds } = await this.collectExportBlocks(
      normalizedDocumentId,
      parentBlockId,
    );
    const rendered = renderFeishuBlocksToMarkdown(blocks, { rootBlockIds });

    return {
      documentId: normalizedDocumentId,
      parentBlockId,
      markdown: rendered.markdown,
      markdownLength: rendered.markdown.length,
      exportedBlocks: rendered.stats.exportedBlocks,
      skippedBlocks: rendered.stats.skippedBlocks,
    };
  }

  private async collectExportBlocks(
    documentId: string,
    parentBlockId: string,
  ): Promise<{ blocks: Array<Record<string, unknown>>; rootBlockIds: string[] }> {
    const blocks = await this.documentBlockService.getAllBlocks(documentId);
    const blockMap = buildBlockMap(blocks);

    let rootBlockIds = extractChildIds(blockMap.get(parentBlockId));
    if (rootBlockIds.length === 0) {
      const children = await this.documentBlockService.getAllChildren(documentId, parentBlockId);
      rootBlockIds = children
        .map((child) => (typeof child.block_id === 'string' ? child.block_id : ''))
        .filter((id) => id.length > 0);

      for (const child of children) {
        const childId = typeof child.block_id === 'string' ? child.block_id : '';
        if (!childId || blockMap.has(childId)) continue;
        blockMap.set(childId, child);
        blocks.push(child);
      }
    }

    return { blocks, rootBlockIds };
  }
}

function requireDocumentId(documentId: string): string {
  const normalized = extractDocumentId(documentId);
  if (!normalized) {
    throw new Error('Invalid document ID or document URL.');
  }
  return normalized;
}

function buildBlockMap(
  blocks: Array<Record<string, unknown>>,
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const block of blocks) {
    const blockId = block.block_id;
    if (typeof blockId === 'string' && blockId.length > 0) {
      map.set(blockId, block);
    }
  }
  return map;
}

function extractChildIds(block: Record<string, unknown> | undefined): string[] {
  if (!block) return [];
  const children = block.children;
  if (!Array.isArray(children)) return [];
  return children.filter((id): id is string => typeof id === 'string' && id.length > 0);
}
