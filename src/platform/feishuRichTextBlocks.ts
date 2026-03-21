export type RichTextBlockType =
  | "heading"
  | "text"
  | "ordered"
  | "bullet"
  | "quote"
  | "code";

export interface RichTextBlockSpec {
  type: RichTextBlockType;
  text: string;
  headingLevel?: number;
  codeLanguage?: number;
  codeWrap?: boolean;
}

export interface RichTextBuildResult {
  children: Array<Record<string, unknown>>;
  typeCounts: Record<RichTextBlockType, number>;
}

export interface RichTextBuildOptions {
  normalizeHeadingLevel: (headingLevel?: number) => number;
  normalizeCodeLanguage: (value: number | undefined) => number | undefined;
}

export function buildRichTextChildren(
  blocks: RichTextBlockSpec[],
  options: RichTextBuildOptions,
): RichTextBuildResult {
  const typeCounts: Record<RichTextBlockType, number> = {
    heading: 0,
    text: 0,
    ordered: 0,
    bullet: 0,
    quote: 0,
    code: 0,
  };

  const children: Array<Record<string, unknown>> = [];
  for (const block of blocks) {
    const text = block.text?.trim();
    if (!text) continue;

    switch (block.type) {
      case "heading": {
        const headingLevel = options.normalizeHeadingLevel(block.headingLevel);
        children.push(buildHeadingBlock(headingLevel, text));
        typeCounts.heading += 1;
        break;
      }
      case "text":
        children.push(buildTextBlock(text));
        typeCounts.text += 1;
        break;
      case "ordered":
        children.push(buildOrderedBlock(text));
        typeCounts.ordered += 1;
        break;
      case "bullet":
        children.push(buildBulletBlock(text));
        typeCounts.bullet += 1;
        break;
      case "quote":
        children.push(buildQuoteBlock(text));
        typeCounts.quote += 1;
        break;
      case "code":
        children.push(
          buildCodeBlock(
            text,
            options.normalizeCodeLanguage(block.codeLanguage),
            block.codeWrap,
          ),
        );
        typeCounts.code += 1;
        break;
      default:
        throw new Error(`Unsupported block type: ${(block as { type: string }).type}`);
    }
  }

  if (children.length === 0) {
    throw new Error("No valid rich-text blocks to create after normalization.");
  }

  return { children, typeCounts };
}

export function buildOrderedBlock(text: string): Record<string, unknown> {
  return {
    block_type: 13,
    ordered: {
      elements: buildTextElements(text),
      style: {
        align: 1,
        folded: false,
      },
    },
  };
}

export function buildBulletBlock(text: string): Record<string, unknown> {
  return {
    block_type: 12,
    bullet: {
      elements: buildTextElements(text),
      style: {
        align: 1,
        folded: false,
      },
    },
  };
}

export function buildQuoteBlock(text: string): Record<string, unknown> {
  return {
    block_type: 15,
    quote: {
      elements: buildTextElements(text),
      style: {
        align: 1,
        folded: false,
      },
    },
  };
}

export function buildCodeBlock(
  text: string,
  language?: number,
  wrap?: boolean,
): Record<string, unknown> {
  const code: Record<string, unknown> = {
    elements: buildTextElements(text, { parseInlineCode: false }),
  };
  if (language !== undefined || wrap !== undefined) {
    const style: Record<string, unknown> = {};
    if (language !== undefined) {
      style.language = language;
    }
    if (wrap !== undefined) {
      style.wrap = wrap;
    }
    code.style = style;
  }
  return {
    block_type: 14,
    code,
  };
}

export function buildTextBlock(text: string): Record<string, unknown> {
  return {
    block_type: 2,
    text: {
      elements: buildTextElements(text),
      style: {
        align: 1,
        folded: false,
      },
    },
  };
}

export function buildHeadingBlock(
  level: number,
  text: string,
): Record<string, unknown> {
  const key = `heading${level}`;
  return {
    block_type: level + 2,
    [key]: {
      elements: buildTextElements(text),
      style: {
        align: 1,
        folded: false,
      },
    },
  };
}

function buildTextElements(
  text: string,
  options: { parseInlineCode?: boolean } = { parseInlineCode: true },
): Array<Record<string, unknown>> {
  if (options.parseInlineCode === false) {
    return [buildPlainTextElement(text)];
  }

  const elements: Array<Record<string, unknown>> = [];

  // Phase 1: Split text into code spans and non-code segments.
  const segments = splitByCodeSpans(text);

  for (const segment of segments) {
    if (segment.isCode) {
      elements.push(
        buildStyledTextElement(
          normalizeInlineCodeContent(segment.text),
          { inline_code: true },
        ),
      );
    } else {
      // Phase 2: Parse bold/italic/strikethrough in non-code segments.
      parseInlineFormatting(segment.text, elements);
    }
  }

  return elements.length > 0 ? elements : [buildPlainTextElement("")];
}

/** Split text into inline-code spans and plain-text segments, preserving order. */
function splitByCodeSpans(text: string): Array<{ text: string; isCode: boolean }> {
  const segments: Array<{ text: string; isCode: boolean }> = [];
  let cursor = 0;

  while (cursor < text.length) {
    const opening = findBacktickRun(text, cursor);
    if (!opening) {
      if (cursor < text.length) {
        segments.push({ text: text.slice(cursor), isCode: false });
      }
      break;
    }

    if (opening.index > cursor) {
      segments.push({ text: text.slice(cursor, opening.index), isCode: false });
    }

    const closing = findMatchingBacktickRun(
      text,
      opening.index + opening.length,
      opening.length,
    );
    if (!closing) {
      segments.push({
        text: text.slice(opening.index, opening.index + opening.length),
        isCode: false,
      });
      cursor = opening.index + opening.length;
      continue;
    }

    segments.push({
      text: text.slice(opening.index + opening.length, closing.index),
      isCode: true,
    });
    cursor = closing.index + closing.length;
  }

  return segments;
}

/**
 * Parse bold, italic, and strikethrough markers in plain text and push
 * styled text elements into the given array.
 *
 * Supported patterns (in matching priority order):
 *   ***text*** → bold + italic
 *   **text**   → bold
 *   *text*     → italic
 *   ~~text~~   → strikethrough
 */
function parseInlineFormatting(
  text: string,
  elements: Array<Record<string, unknown>>,
): void {
  // The regex alternation order ensures longer markers match first.
  // Group 1: bold+italic, Group 2: bold, Group 3: italic, Group 4: strikethrough
  const pattern = /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|(?<!\*)\*([^*\n]+?)\*(?!\*)|~~(.+?)~~/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    // Push preceding plain text
    if (match.index > lastIndex) {
      pushTextElement(elements, text.slice(lastIndex, match.index));
    }

    if (match[1] !== undefined) {
      elements.push(buildStyledTextElement(match[1], { bold: true, italic: true }));
    } else if (match[2] !== undefined) {
      elements.push(buildStyledTextElement(match[2], { bold: true }));
    } else if (match[3] !== undefined) {
      elements.push(buildStyledTextElement(match[3], { italic: true }));
    } else if (match[4] !== undefined) {
      elements.push(buildStyledTextElement(match[4], { strikethrough: true }));
    }

    lastIndex = match.index + match[0].length;
  }

  // Push trailing plain text
  if (lastIndex < text.length) {
    pushTextElement(elements, text.slice(lastIndex));
  }
}

function buildPlainTextElement(text: string): Record<string, unknown> {
  return buildStyledTextElement(text);
}

interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  inline_code?: boolean;
}

function buildStyledTextElement(
  text: string,
  style?: InlineStyle,
): Record<string, unknown> {
  const textRun: Record<string, unknown> = {
    content: text,
  };
  if (style) {
    const elementStyle: Record<string, boolean> = {};
    if (style.bold) elementStyle.bold = true;
    if (style.italic) elementStyle.italic = true;
    if (style.strikethrough) elementStyle.strikethrough = true;
    if (style.inline_code) elementStyle.inline_code = true;
    if (Object.keys(elementStyle).length > 0) {
      textRun.text_element_style = elementStyle;
    }
  }
  return {
    text_run: textRun,
  };
}

function pushTextElement(
  elements: Array<Record<string, unknown>>,
  text: string,
): void {
  if (text.length === 0) return;
  elements.push(buildPlainTextElement(text));
}

function findBacktickRun(
  text: string,
  start: number,
): { index: number; length: number } | null {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] !== "`") continue;
    let end = index + 1;
    while (end < text.length && text[end] === "`") {
      end += 1;
    }
    return {
      index,
      length: end - index,
    };
  }
  return null;
}

function findMatchingBacktickRun(
  text: string,
  start: number,
  targetLength: number,
): { index: number; length: number } | null {
  let index = start;
  while (index < text.length) {
    const match = findBacktickRun(text, index);
    if (!match) return null;
    if (match.length === targetLength) {
      return match;
    }
    index = match.index + match.length;
  }
  return null;
}

function normalizeInlineCodeContent(text: string): string {
  const normalizedWhitespace = text.replace(/\r\n?/g, "\n").replace(/\n/g, " ");
  if (
    normalizedWhitespace.length >= 2 &&
    normalizedWhitespace.startsWith(" ") &&
    normalizedWhitespace.endsWith(" ") &&
    /[^ ]/.test(normalizedWhitespace)
  ) {
    return normalizedWhitespace.slice(1, -1);
  }
  return normalizedWhitespace;
}
