import {
  buildBulletBlock,
  buildCodeBlock,
  buildHeadingBlock,
  buildOrderedBlock,
  buildQuoteBlock,
  buildTextBlock,
} from './documentEdit/richTextBlocks.js';

interface ParsedMarkdownBlock {
  type: 'heading' | 'text' | 'ordered' | 'bullet' | 'quote' | 'code';
  text: string;
  headingLevel?: number;
  codeFence?: string;
  codeLanguage?: string;
}

export interface MarkdownParseResult {
  children: Array<Record<string, unknown>>;
  stats: {
    totalBlocks: number;
    headingCount: number;
    paragraphCount: number;
    orderedCount: number;
    bulletCount: number;
    quoteCount: number;
    codeCount: number;
  };
}

export interface MarkdownRenderResult {
  markdown: string;
  stats: {
    exportedBlocks: number;
    skippedBlocks: number;
  };
}

export function parseMarkdownToFeishuBlocks(markdown: string): MarkdownParseResult {
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

    if (isOrderedListLine(line)) {
      const block = collectListBlock(lines, index, 'ordered');
      parsedBlocks.push(...block.blocks);
      index = block.nextIndex;
      continue;
    }

    if (isBulletListLine(line)) {
      const block = collectListBlock(lines, index, 'bullet');
      parsedBlocks.push(...block.blocks);
      index = block.nextIndex;
      continue;
    }

    const block = collectParagraphBlock(lines, index);
    parsedBlocks.push(block.block);
    index = block.nextIndex;
  }

  return {
    children: parsedBlocks.map(convertParsedBlockToFeishuBlock),
    stats: summarizeParsedBlocks(parsedBlocks),
  };
}

export function renderFeishuBlocksToMarkdown(
  blocks: Array<Record<string, unknown>>,
): MarkdownRenderResult {
  const chunks: string[] = [];
  let exportedBlocks = 0;
  let skippedBlocks = 0;

  for (const block of blocks) {
    const rendered = renderSingleBlock(block);
    if (!rendered) {
      skippedBlocks += 1;
      continue;
    }
    exportedBlocks += 1;
    chunks.push(rendered);
  }

  const markdown = chunks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return {
    markdown,
    stats: {
      exportedBlocks,
      skippedBlocks,
    },
  };
}

function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, '\n').trim();
}

function summarizeParsedBlocks(blocks: ParsedMarkdownBlock[]): MarkdownParseResult['stats'] {
  return blocks.reduce<MarkdownParseResult['stats']>(
    (stats, block) => {
      stats.totalBlocks += 1;
      switch (block.type) {
        case 'heading':
          stats.headingCount += 1;
          break;
        case 'text':
          stats.paragraphCount += 1;
          break;
        case 'ordered':
          stats.orderedCount += 1;
          break;
        case 'bullet':
          stats.bulletCount += 1;
          break;
        case 'quote':
          stats.quoteCount += 1;
          break;
        case 'code':
          stats.codeCount += 1;
          break;
      }
      return stats;
    },
    {
      totalBlocks: 0,
      headingCount: 0,
      paragraphCount: 0,
      orderedCount: 0,
      bulletCount: 0,
      quoteCount: 0,
      codeCount: 0,
    },
  );
}

function convertParsedBlockToFeishuBlock(
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

function collectListBlock(
  lines: string[],
  startIndex: number,
  type: 'ordered' | 'bullet',
): { blocks: ParsedMarkdownBlock[]; nextIndex: number } {
  const blocks: ParsedMarkdownBlock[] = [];
  let index = startIndex;
  const pattern =
    type === 'ordered' ? /^\d+[.)][ \t]+(.+?)\s*$/ : /^[-*+][ \t]+(.+?)\s*$/;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const match = line.match(pattern);
    if (!match) break;
    blocks.push({
      type,
      text: match[1].trim(),
    });
    index += 1;
  }

  return {
    blocks,
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
    if (isQuoteLine(line) || isOrderedListLine(line) || isBulletListLine(line)) break;
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

function renderSingleBlock(block: Record<string, unknown>): string | null {
  const blockType = extractBlockType(block);
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
      return `- ${renderInlineElements(extractElements(block, 'bullet'))}`.trimEnd();
    case 13:
      return `1. ${renderInlineElements(extractElements(block, 'ordered'))}`.trimEnd();
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
    default:
      return null;
  }
}

function extractBlockType(block: Record<string, unknown>): number | undefined {
  return typeof block.block_type === 'number' ? block.block_type : undefined;
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
