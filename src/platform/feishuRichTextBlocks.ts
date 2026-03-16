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
  let cursor = 0;

  while (cursor < text.length) {
    const opening = findBacktickRun(text, cursor);
    if (!opening) {
      pushTextElement(elements, text.slice(cursor));
      break;
    }

    if (opening.index > cursor) {
      pushTextElement(elements, text.slice(cursor, opening.index));
    }

    const closing = findMatchingBacktickRun(
      text,
      opening.index + opening.length,
      opening.length,
    );
    if (!closing) {
      pushTextElement(elements, text.slice(opening.index, opening.index + opening.length));
      cursor = opening.index + opening.length;
      continue;
    }

    elements.push(
      buildStyledTextElement(
        normalizeInlineCodeContent(
          text.slice(opening.index + opening.length, closing.index),
        ),
        { inline_code: true },
      ),
    );
    cursor = closing.index + closing.length;
  }

  return elements.length > 0 ? elements : [buildPlainTextElement("")];
}

function buildPlainTextElement(text: string): Record<string, unknown> {
  return buildStyledTextElement(text);
}

function buildStyledTextElement(
  text: string,
  style?: { inline_code?: boolean },
): Record<string, unknown> {
  const textRun: Record<string, unknown> = {
    content: text,
  };
  if (style?.inline_code) {
    textRun.text_element_style = {
      inline_code: true,
    };
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
