import {
  buildBulletBlock,
  buildCodeBlock,
  buildHeadingBlock,
  buildOrderedBlock,
  buildQuoteBlock,
  buildTextBlock,
} from './feishuRichTextBlocks.js';
import { buildTableBlock } from './feishuTableBlocks.js';
import {
  extractBlockId,
  extractBlockText as extractPlatformBlockText,
  extractBlockType,
  extractChildIds,
} from './feishuBlockIntrospection.js';
import type {
  NoteMarkdownNestedBlock,
  NoteMarkdownParseResult,
  NoteMarkdownParseStats,
  NoteMarkdownRenderOptions,
  NoteMarkdownRenderResult,
} from './types.js';

interface ParsedMarkdownBlock {
  type: 'heading' | 'text' | 'ordered' | 'bullet' | 'quote' | 'code' | 'table';
  text: string;
  headingLevel?: number;
  codeFence?: string;
  codeLanguage?: string;
  children?: ParsedMarkdownBlock[];
  tableRows?: string[][];
}

export type NestedMarkdownBlock = NoteMarkdownNestedBlock;
export type NestedFeishuBlock = NestedMarkdownBlock;
export type NestedMarkdownParseResult = NoteMarkdownParseResult;

export interface MarkdownParseResult {
  children: Array<Record<string, unknown>>;
  stats: NoteMarkdownParseStats;
}

export type MarkdownRenderResult = NoteMarkdownRenderResult;
export type MarkdownRenderOptions = NoteMarkdownRenderOptions;

export function parseMarkdownToBlocks(markdown: string): MarkdownParseResult {
  const nested = parseMarkdownToNestedBlocks(markdown);
  return {
    children: flattenNestedBlocks(nested.nestedChildren),
    stats: nested.stats,
  };
}

export const parseMarkdownToFeishuBlocks = parseMarkdownToBlocks;

export function parseMarkdownToNestedBlocks(markdown: string): NestedMarkdownParseResult {
  const normalized = normalizeMarkdown(markdown);
  const lines = normalized.split('\n');
  const parsedBlocks: ParsedMarkdownBlock[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const codeFence = parseFenceStart(line);
    if (codeFence) {
      const block = collectFencedCodeBlock(lines, index, codeFence);
      parsedBlocks.push(block.block);
      index = block.nextIndex;
      continue;
    }

    const heading = line.match(/^(#{1,9})[ \t]+(.+?)\s*$/);
    if (heading) {
      parsedBlocks.push({
        type: 'heading',
        headingLevel: heading[1].length,
        text: heading[2].trim(),
      });
      index += 1;
      continue;
    }

    if (isQuoteLine(line)) {
      const block = collectQuoteBlock(lines, index);
      parsedBlocks.push(block.block);
      index = block.nextIndex;
      continue;
    }

    // Table detection: line starts with | and has at least one | separator.
    if (isTableLine(line)) {
      const table = collectTableBlock(lines, index);
      if (table) {
        parsedBlocks.push(table.block);
        index = table.nextIndex;
        continue;
      }
    }

    if (isOrderedListLine(line)) {
      const block = collectNestedListBlock(lines, index, 'ordered');
      parsedBlocks.push(...block.blocks);
      index = block.nextIndex;
      continue;
    }

    if (isBulletListLine(line)) {
      const block = collectNestedListBlock(lines, index, 'bullet');
      parsedBlocks.push(...block.blocks);
      index = block.nextIndex;
      continue;
    }

    // Standalone indented list items (not preceded by a top-level list).
    if (isIndentedListLine(line)) {
      const subOrderedPattern = /^[ \t]+\d+[.)][ \t]+(.+?)\s*$/;
      const subBulletPattern = /^[ \t]+[-*+][ \t]+(.+?)\s*$/;
      while (index < lines.length) {
        const subLine = lines[index] ?? '';
        const subOrdered = subLine.match(subOrderedPattern);
        const subBullet = subLine.match(subBulletPattern);
        const subMatch = subOrdered || subBullet;
        if (!subMatch) break;
        parsedBlocks.push({
          type: subOrdered ? 'ordered' : 'bullet',
          text: subMatch[1].trim(),
        });
        index += 1;
      }
      continue;
    }

    const block = collectParagraphBlock(lines, index);
    parsedBlocks.push(block.block);
    index = block.nextIndex;
  }

  return {
    nestedChildren: parsedBlocks.map(convertParsedBlockToNested),
    stats: summarizeParsedBlocks(parsedBlocks),
  };
}

function flattenNestedBlocks(nested: NestedMarkdownBlock[]): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  for (const item of nested) {
    result.push(item.block);
    if (item.children && item.children.length > 0) {
      result.push(...flattenNestedBlocks(item.children));
    }
  }
  return result;
}

function convertParsedBlockToNested(block: ParsedMarkdownBlock): NestedMarkdownBlock {
  const platformBlock = convertParsedBlockToPlatformBlock(block);
  const nested: NestedMarkdownBlock = { block: platformBlock };
  if (block.children && block.children.length > 0) {
    nested.children = block.children.map(convertParsedBlockToNested);
  }
  if (block.tableRows) {
    nested.tableRows = block.tableRows;
  }
  return nested;
}

export function renderBlocksToMarkdown(
  blocks: Array<Record<string, unknown>>,
  options: MarkdownRenderOptions = {},
): MarkdownRenderResult {
  const chunks: string[] = [];
  const blockMap = buildBlockMap(blocks);
  const stats: MarkdownRenderResult['stats'] = {
    exportedBlocks: 0,
    skippedBlocks: 0,
  };

  if (Array.isArray(options.rootBlockIds) && options.rootBlockIds.length > 0) {
    const visited = new Set<string>();
    for (const blockId of options.rootBlockIds) {
      const rendered = renderBlockFromId(
        blockId,
        {
          blockMap,
          visited,
          stats,
        },
        0,
      );
      if (rendered) {
        chunks.push(rendered);
      }
    }
  } else {
    for (const block of blocks) {
      const rendered = renderSingleBlock(block, blockMap, 0);
      if (!rendered) {
        stats.skippedBlocks += 1;
        continue;
      }
      stats.exportedBlocks += 1;
      chunks.push(rendered);
    }
  }

  const markdown = chunks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return {
    markdown,
    stats,
  };
}

export const renderFeishuBlocksToMarkdown = renderBlocksToMarkdown;

interface RenderTraversalContext {
  blockMap: Map<string, Record<string, unknown>>;
  visited: Set<string>;
  stats: MarkdownRenderResult['stats'];
}

function renderBlockFromId(
  blockId: string,
  context: RenderTraversalContext,
  listDepth: number,
): string | null {
  if (context.visited.has(blockId)) {
    return null;
  }
  const block = context.blockMap.get(blockId);
  if (!block) {
    return null;
  }
  context.visited.add(blockId);
  return renderBlockRecursive(block, context, listDepth);
}

function renderBlockRecursive(
  block: Record<string, unknown>,
  context: RenderTraversalContext,
  listDepth: number,
): string | null {
  const blockType = extractBlockType(block);
  const rendered = renderSingleBlock(block, context.blockMap, listDepth);
  if (rendered) {
    context.stats.exportedBlocks += 1;
  } else {
    context.stats.skippedBlocks += 1;
  }

  if (blockType === 12 || blockType === 13) {
    const lines: string[] = [];
    if (rendered) {
      lines.push(rendered);
    }
    for (const childId of extractChildIds(block)) {
      const child = context.blockMap.get(childId);
      if (!child) continue;
      const childType = extractBlockType(child);
      const childRendered = renderBlockFromId(childId, context, listDepth + 1);
      if (!childRendered) continue;
      if (childType === 12 || childType === 13) {
        lines.push(childRendered);
      } else {
        const indent = '  '.repeat(listDepth + 1);
        lines.push(
          childRendered
            .split('\n')
            .map((line) => `${indent}${line}`)
            .join('\n'),
        );
      }
    }
    return lines.length > 0 ? lines.join('\n') : null;
  }

  if (!rendered) {
    const childChunks: string[] = [];
    for (const childId of extractChildIds(block)) {
      const childRendered = renderBlockFromId(childId, context, listDepth);
      if (childRendered) {
        childChunks.push(childRendered);
      }
    }
    return childChunks.length > 0 ? childChunks.join('\n\n') : null;
  }

  return rendered;
}

function buildBlockMap(
  blocks: Array<Record<string, unknown>>,
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const block of blocks) {
    const id = extractBlockId(block);
    if (id) {
      map.set(id, block);
    }
  }
  return map;
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, '\n').trim();
}

function summarizeParsedBlocks(blocks: ParsedMarkdownBlock[]): MarkdownParseResult['stats'] {
  const stats: MarkdownParseResult['stats'] = {
    totalBlocks: 0,
    headingCount: 0,
    paragraphCount: 0,
    orderedCount: 0,
    bulletCount: 0,
    quoteCount: 0,
    codeCount: 0,
    tableCount: 0,
  };

  function countRecursive(block: ParsedMarkdownBlock): void {
    stats.totalBlocks += 1;
    switch (block.type) {
      case 'heading': stats.headingCount += 1; break;
      case 'text': stats.paragraphCount += 1; break;
      case 'ordered': stats.orderedCount += 1; break;
      case 'bullet': stats.bulletCount += 1; break;
      case 'quote': stats.quoteCount += 1; break;
      case 'code': stats.codeCount += 1; break;
      case 'table': stats.tableCount += 1; break;
    }
    if (block.children) {
      for (const child of block.children) {
        countRecursive(child);
      }
    }
  }

  for (const block of blocks) {
    countRecursive(block);
  }
  return stats;
}

function convertParsedBlockToPlatformBlock(
  block: ParsedMarkdownBlock,
): Record<string, unknown> {
  switch (block.type) {
    case 'heading':
      return buildHeadingBlock(block.headingLevel ?? 2, block.text);
    case 'text':
      return buildTextBlock(block.text);
    case 'ordered':
      return buildOrderedBlock(block.text);
    case 'bullet':
      return buildBulletBlock(block.text);
    case 'quote':
      return buildQuoteBlock(block.text);
    case 'code':
      return buildCodeBlock(block.text);
    case 'table': {
      const rows = block.tableRows ?? [];
      const rowSize = rows.length;
      const colSize = rowSize > 0 ? rows[0].length : 0;
      return buildTableBlock(rowSize, colSize);
    }
  }
}

function parseFenceStart(
  line: string,
): { marker: '`' | '~'; length: number; language?: string } | null {
  const match = line.match(/^([`~]{3,})(.*)$/);
  if (!match) return null;
  const marker = match[1][0] as '`' | '~';
  const language = match[2].trim().split(/\s+/, 1)[0];
  return {
    marker,
    length: match[1].length,
    language: language || undefined,
  };
}

function collectFencedCodeBlock(
  lines: string[],
  startIndex: number,
  fence: { marker: '`' | '~'; length: number; language?: string },
): { block: ParsedMarkdownBlock; nextIndex: number } {
  const content: string[] = [];
  let index = startIndex + 1;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const match = line.match(/^([`~]{3,})\s*$/);
    if (match && match[1][0] === fence.marker && match[1].length >= fence.length) {
      return {
        block: {
          type: 'code',
          text: content.join('\n'),
          codeFence: fence.marker.repeat(fence.length),
          codeLanguage: fence.language,
        },
        nextIndex: index + 1,
      };
    }
    content.push(line);
    index += 1;
  }

  return {
    block: {
      type: 'code',
      text: content.join('\n'),
      codeFence: fence.marker.repeat(fence.length),
      codeLanguage: fence.language,
    },
    nextIndex: lines.length,
  };
}

function isQuoteLine(line: string): boolean {
  return /^>[ \t]?/.test(line);
}

function collectQuoteBlock(
  lines: string[],
  startIndex: number,
): { block: ParsedMarkdownBlock; nextIndex: number } {
  const content: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) {
      if (index + 1 < lines.length && isQuoteLine(lines[index + 1] ?? '')) {
        content.push('');
        index += 1;
        continue;
      }
      break;
    }
    if (!isQuoteLine(line)) break;
    content.push(line.replace(/^>[ \t]?/, ''));
    index += 1;
  }

  return {
    block: {
      type: 'quote',
      text: content.join('\n').trim(),
    },
    nextIndex: index,
  };
}

function isOrderedListLine(line: string): boolean {
  return /^\d+[.)][ \t]+/.test(line);
}

function isBulletListLine(line: string): boolean {
  return /^[-*+][ \t]+/.test(line);
}

function isIndentedListLine(line: string): boolean {
  return /^[ \t]+[-*+\d]/.test(line);
}

function getIndentLevel(line: string): number {
  const match = line.match(/^([ \t]*)/);
  if (!match) return 0;
  const indent = match[1];
  let level = 0;
  for (const ch of indent) {
    level += ch === '\t' ? 4 : 1;
  }
  return Math.floor(level / 2); // 2 spaces = 1 level
}

function collectNestedListBlock(
  lines: string[],
  startIndex: number,
  type: 'ordered' | 'bullet',
): { blocks: ParsedMarkdownBlock[]; nextIndex: number } {
  const topPattern =
    type === 'ordered' ? /^\d+[.)][ \t]+(.+?)\s*$/ : /^[-*+][ \t]+(.+?)\s*$/;

  // Collect all contiguous list lines (top-level + indented) with their indent levels.
  interface RawListItem {
    text: string;
    type: 'ordered' | 'bullet';
    indent: number;
  }
  const items: RawListItem[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) break;

    // Top-level item
    const topMatch = line.match(topPattern);
    if (topMatch) {
      items.push({ text: topMatch[1].trim(), type, indent: 0 });
      index += 1;
      continue;
    }

    // Indented sub-item
    const subOrdered = line.match(/^([ \t]+)\d+[.)][ \t]+(.+?)\s*$/);
    const subBullet = line.match(/^([ \t]+)[-*+][ \t]+(.+?)\s*$/);
    if (subOrdered) {
      items.push({
        text: subOrdered[2].trim(),
        type: 'ordered',
        indent: getIndentLevel(line),
      });
      index += 1;
      continue;
    }
    if (subBullet) {
      items.push({
        text: subBullet[2].trim(),
        type: 'bullet',
        indent: getIndentLevel(line),
      });
      index += 1;
      continue;
    }
    break;
  }

  // Build tree from flat items with indent levels.
  function buildTree(flatItems: RawListItem[], baseIndent: number): ParsedMarkdownBlock[] {
    const result: ParsedMarkdownBlock[] = [];
    let i = 0;
    while (i < flatItems.length) {
      const item = flatItems[i];
      if (item.indent < baseIndent) break;
      if (item.indent === baseIndent) {
        const block: ParsedMarkdownBlock = {
          type: item.type,
          text: item.text,
        };
        // Collect children (items with higher indent immediately following)
        const childItems: RawListItem[] = [];
        let j = i + 1;
        while (j < flatItems.length && flatItems[j].indent > baseIndent) {
          childItems.push(flatItems[j]);
          j += 1;
        }
        if (childItems.length > 0) {
          block.children = buildTree(childItems, baseIndent + 1);
        }
        result.push(block);
        i = j;
      } else {
        // Item has higher indent than expected, treat as child of previous
        // This handles cases with inconsistent indentation
        const block: ParsedMarkdownBlock = {
          type: item.type,
          text: item.text,
        };
        result.push(block);
        i += 1;
      }
    }
    return result;
  }

  const blocks = buildTree(items, 0);
  return { blocks, nextIndex: index };
}

function isTableLine(line: string): boolean {
  return /^\|/.test(line.trim()) && line.trim().includes('|');
}

function isTableSeparatorLine(line: string): boolean {
  return /^\|[\s:|-]+\|\s*$/.test(line.trim());
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  // Remove leading and trailing |
  const inner = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  const cleaned = inner.endsWith('|') ? inner.slice(0, -1) : inner;
  return cleaned.split('|').map(cell => cell.trim());
}

function collectTableBlock(
  lines: string[],
  startIndex: number,
): { block: ParsedMarkdownBlock; nextIndex: number } | null {
  let index = startIndex;

  // First line is the header row
  const headerLine = lines[index] ?? '';
  if (!isTableLine(headerLine)) return null;
  const headers = parseTableRow(headerLine);
  index += 1;

  // Second line must be the separator
  if (index >= lines.length) return null;
  const separatorLine = lines[index] ?? '';
  if (!isTableSeparatorLine(separatorLine)) return null;
  index += 1;

  // Collect body rows
  const rows: string[][] = [headers];
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!isTableLine(line) || isTableSeparatorLine(line)) break;
    if (line.trim().length === 0) break;
    rows.push(parseTableRow(line));
    index += 1;
  }

  // Normalize column count
  const colCount = headers.length;
  for (const row of rows) {
    while (row.length < colCount) row.push('');
    if (row.length > colCount) row.length = colCount;
  }

  return {
    block: {
      type: 'table',
      text: '',
      tableRows: rows,
    },
    nextIndex: index,
  };
}

function collectParagraphBlock(
  lines: string[],
  startIndex: number,
): { block: ParsedMarkdownBlock; nextIndex: number } {
  const content: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) break;
    if (parseFenceStart(line)) break;
    if (/^(#{1,9})[ \t]+/.test(line)) break;
    if (
      isQuoteLine(line) ||
      isOrderedListLine(line) ||
      isBulletListLine(line) ||
      isIndentedListLine(line) ||
      isTableLine(line)
    ) break;
    content.push(line.trim());
    index += 1;
  }

  return {
    block: {
      type: 'text',
      text: content.join(' ').trim(),
    },
    nextIndex: index,
  };
}

function renderSingleBlock(
  block: Record<string, unknown>,
  blockMap?: Map<string, Record<string, unknown>>,
  listDepth = 0,
): string | null {
  const blockType = extractBlockType(block);
  const listIndent = '  '.repeat(Math.max(0, listDepth));
  switch (blockType) {
    case 2:
      return renderInlineElements(extractElements(block, 'text'));
    case 3:
    case 4:
    case 5:
    case 6:
    case 7:
    case 8:
    case 9:
    case 10:
    case 11: {
      const level = blockType - 2;
      const text = renderInlineElements(extractElements(block, `heading${level}`));
      return `${'#'.repeat(level)} ${text}`.trim();
    }
    case 12:
      return `${listIndent}- ${renderInlineElements(extractElements(block, 'bullet'))}`.trimEnd();
    case 13:
      return `${listIndent}1. ${renderInlineElements(extractElements(block, 'ordered'))}`.trimEnd();
    case 14: {
      const codeText = renderPlainText(extractElements(block, 'code'));
      return renderCodeFence(codeText);
    }
    case 15: {
      const quoteText = renderInlineElements(extractElements(block, 'quote'));
      return quoteText
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    }
    case 31:
      return renderTableBlock(block, blockMap);
    default:
      return null;
  }
}

function extractElements(
  block: Record<string, unknown>,
  key: string,
): Array<Record<string, unknown>> {
  const container = block[key];
  if (!container || typeof container !== 'object') return [];
  const elements = (container as Record<string, unknown>).elements;
  return Array.isArray(elements) ? (elements as Array<Record<string, unknown>>) : [];
}

function renderPlainText(elements: Array<Record<string, unknown>>): string {
  return elements.map(extractElementText).join('');
}

function renderInlineElements(elements: Array<Record<string, unknown>>): string {
  return elements
    .map((element) => {
      const textRun = element.text_run;
      if (!textRun || typeof textRun !== 'object') {
        return extractElementText(element);
      }
      const textRunRecord = textRun as Record<string, unknown>;
      const content =
        typeof textRunRecord.content === 'string' ? textRunRecord.content : '';
      const style =
        textRunRecord.text_element_style &&
        typeof textRunRecord.text_element_style === 'object'
          ? (textRunRecord.text_element_style as Record<string, unknown>)
          : {};
      // Check for link
      const link = style.link;
      if (link && typeof link === 'object') {
        const linkRecord = link as Record<string, unknown>;
        const url = typeof linkRecord.url === 'string' ? linkRecord.url : '';
        if (url) {
          const styledContent = applyMarkdownStyles(content, { ...style, link: undefined });
          return `[${styledContent}](${url})`;
        }
      }
      return applyMarkdownStyles(content, style);
    })
    .join('');
}

function extractElementText(element: Record<string, unknown>): string {
  const textRun = element.text_run;
  if (textRun && typeof textRun === 'object') {
    const textRunRecord = textRun as Record<string, unknown>;
    if (typeof textRunRecord.content === 'string') {
      return textRunRecord.content;
    }
  }
  const equation = element.equation;
  if (equation && typeof equation === 'object') {
    const equationRecord = equation as Record<string, unknown>;
    if (typeof equationRecord.content === 'string') {
      return `$${equationRecord.content}$`;
    }
  }
  return '';
}

function applyMarkdownStyles(
  content: string,
  style: Record<string, unknown>,
): string {
  if (content.length === 0) return '';
  if (style.inline_code === true) {
    return wrapInlineCode(content);
  }

  let result = escapeMarkdownText(content);
  const bold = style.bold === true;
  const italic = style.italic === true;
  const strikethrough = style.strikethrough === true;
  const underline = style.underline === true;

  if (bold && italic) {
    result = `***${result}***`;
  } else if (bold) {
    result = `**${result}**`;
  } else if (italic) {
    result = `*${result}*`;
  }

  if (strikethrough) {
    result = `~~${result}~~`;
  }
  if (underline) {
    result = `<u>${result}</u>`;
  }
  return result;
}

function wrapInlineCode(content: string): string {
  const maxRunLength = longestBacktickRun(content);
  const fence = '`'.repeat(Math.max(1, maxRunLength + 1));
  const needsPadding =
    content.startsWith('`') || content.endsWith('`') || /^\s|\s$/.test(content);
  return needsPadding ? `${fence} ${content} ${fence}` : `${fence}${content}${fence}`;
}

function longestBacktickRun(text: string): number {
  const matches = text.match(/`+/g);
  if (!matches) return 0;
  return matches.reduce((max, match) => Math.max(max, match.length), 0);
}

function escapeMarkdownText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/([*_~])/g, '\\$1');
}

function renderCodeFence(text: string): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(text) + 1));
  return `${fence}\n${text}\n${fence}`;
}

function renderTableBlock(
  block: Record<string, unknown>,
  blockMap?: Map<string, Record<string, unknown>>,
): string | null {
  const table = block.table;
  if (!table || typeof table !== 'object') return null;
  const tableRecord = table as Record<string, unknown>;
  const property = tableRecord.property as Record<string, unknown> | undefined;
  if (!property) return null;

  const rowSize = typeof property.row_size === 'number' ? property.row_size : 0;
  const colSize = typeof property.column_size === 'number' ? property.column_size : 0;
  if (rowSize === 0 || colSize === 0) return null;

  // Cells are block IDs listed row by row.
  const cellIds = Array.isArray(tableRecord.cells)
    ? (tableRecord.cells as string[])
    : [];

  const getCellText = (cellId: string): string => {
    if (!blockMap) return '';
    const cellBlock = blockMap.get(cellId);
    if (!cellBlock) return '';
    // Cell block may contain children. Try to extract text from it directly.
    // Cell blocks are container blocks (block_type 1 = page) with children.
    // Look for text content in common text-bearing children.
    const children = extractChildIds(cellBlock);
    if (children.length > 0) {
      const parts: string[] = [];
      for (const childId of children) {
        const childBlock = blockMap.get(childId);
        if (!childBlock) continue;
        const text = extractPlatformBlockText(childBlock);
        if (text.length > 0) {
          parts.push(text);
        }
      }
      return parts.join(' ').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    }
    // Fallback: try to read text directly from the cell block itself.
    return extractPlatformBlockText(cellBlock)
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ');
  };

  const rows: string[][] = [];
  for (let r = 0; r < rowSize; r++) {
    const row: string[] = [];
    for (let c = 0; c < colSize; c++) {
      const idx = r * colSize + c;
      const cellId = cellIds[idx];
      row.push(cellId ? getCellText(cellId) : '');
    }
    rows.push(row);
  }

  if (rows.length === 0) return null;

  const lines: string[] = [];
  // Header row
  const header = rows[0];
  lines.push(`| ${header.join(' | ')} |`);
  // Separator
  lines.push(`| ${header.map(() => '---').join(' | ')} |`);
  // Body rows
  for (let r = 1; r < rows.length; r++) {
    lines.push(`| ${rows[r].join(' | ')} |`);
  }

  return lines.join('\n');
}
