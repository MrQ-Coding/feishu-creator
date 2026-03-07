export interface SectionRange {
  startIndex: number;
  endIndex: number;
  headingText: string;
}

interface HeadingInfo {
  index: number;
  level: number;
  text: string;
}

export function findSectionRangeByHeadingText(
  siblings: Array<Record<string, unknown>>,
  sectionHeading: string,
  sectionOccurrence: number,
): SectionRange | null {
  const headings = collectHeadings(siblings);
  const candidates = headings.filter((item) => item.text === sectionHeading);
  if (candidates.length < sectionOccurrence) return null;
  const target = candidates[sectionOccurrence - 1];
  const endIndex = computeSectionEndIndex(headings, siblings.length, target);
  return {
    startIndex: target.index + 1,
    endIndex,
    headingText: target.text,
  };
}

export function findSectionRangeByHeadingPath(
  siblings: Array<Record<string, unknown>>,
  headingPath: string[],
  sectionOccurrence: number,
): SectionRange | null {
  const headings = collectHeadings(siblings);
  if (headingPath.length === 0) return null;

  const matches = matchHeadingPath(headings, siblings.length, headingPath);
  if (matches.length < sectionOccurrence) return null;
  const target = matches[sectionOccurrence - 1];
  const endIndex = computeSectionEndIndex(headings, siblings.length, target);
  return {
    startIndex: target.index + 1,
    endIndex,
    headingText: target.text,
  };
}

function collectHeadings(
  siblings: Array<Record<string, unknown>>,
): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  for (let i = 0; i < siblings.length; i += 1) {
    const block = siblings[i];
    const level = extractHeadingLevel(block);
    if (level === undefined) continue;
    const text = extractBlockText(block);
    headings.push({ index: i, level, text });
  }
  return headings;
}

function matchHeadingPath(
  headings: HeadingInfo[],
  totalSiblingCount: number,
  headingPath: string[],
): HeadingInfo[] {
  const result: HeadingInfo[] = [];
  const starts = headings.filter((item) => item.text === headingPath[0]);
  for (const start of starts) {
    walkHeadingPath(headings, totalSiblingCount, headingPath, 0, start, result);
  }
  return result;
}

function walkHeadingPath(
  headings: HeadingInfo[],
  totalSiblingCount: number,
  headingPath: string[],
  pathIndex: number,
  current: HeadingInfo,
  result: HeadingInfo[],
): void {
  if (pathIndex === headingPath.length - 1) {
    result.push(current);
    return;
  }

  const nextText = headingPath[pathIndex + 1];
  const sectionEnd = computeSectionEndIndex(headings, totalSiblingCount, current);
  for (const heading of headings) {
    if (heading.index <= current.index) continue;
    if (heading.index >= sectionEnd) break;
    if (heading.level <= current.level) continue;
    if (heading.text !== nextText) continue;
    walkHeadingPath(
      headings,
      totalSiblingCount,
      headingPath,
      pathIndex + 1,
      heading,
      result,
    );
  }
}

function computeSectionEndIndex(
  headings: Array<{ index: number; level: number }>,
  totalSiblingCount: number,
  current: { index: number; level: number },
): number {
  for (const heading of headings) {
    if (heading.index <= current.index) continue;
    if (heading.level <= current.level) {
      return heading.index;
    }
  }
  return totalSiblingCount;
}

function extractBlockType(block: Record<string, unknown>): number | undefined {
  const value = block.block_type;
  return typeof value === "number" ? value : undefined;
}

function extractHeadingLevel(block: Record<string, unknown>): number | undefined {
  const keyToLevel: Array<[string, number]> = [
    ["heading1", 1],
    ["heading2", 2],
    ["heading3", 3],
    ["heading4", 4],
    ["heading5", 5],
    ["heading6", 6],
    ["heading7", 7],
    ["heading8", 8],
    ["heading9", 9],
  ];
  for (const [key, level] of keyToLevel) {
    if (key in block) return level;
  }

  const blockType = extractBlockType(block);
  if (blockType === undefined) return undefined;
  if (blockType >= 3 && blockType <= 11) {
    return blockType - 2;
  }
  return undefined;
}

function extractBlockText(block: Record<string, unknown>): string {
  const textContainer = extractTextContainer(block);
  if (!textContainer) return "";
  const elements = textContainer.elements;
  if (!Array.isArray(elements)) return "";
  let text = "";
  for (const element of elements) {
    if (!element || typeof element !== "object") continue;
    const textRun = (element as Record<string, unknown>).text_run;
    if (!textRun || typeof textRun !== "object") continue;
    const content = (textRun as Record<string, unknown>).content;
    if (typeof content === "string") {
      text += content;
    }
  }
  return text.trim();
}

function extractTextContainer(
  block: Record<string, unknown>,
): Record<string, unknown> | null {
  const keys = [
    "heading1",
    "heading2",
    "heading3",
    "heading4",
    "heading5",
    "heading6",
    "heading7",
    "heading8",
    "heading9",
    "ordered",
    "bullet",
    "text",
    "page",
  ];
  for (const key of keys) {
    const value = block[key];
    if (value && typeof value === "object") {
      return value as Record<string, unknown>;
    }
  }
  return null;
}
