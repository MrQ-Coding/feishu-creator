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

interface RichTextBuildOptions {
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
    elements: buildTextElements(text),
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

function buildTextElements(text: string): Array<Record<string, unknown>> {
  return [
    {
      text_run: {
        content: text,
      },
    },
  ];
}
