import type { NotePlatformProvider } from '../../platform/index.js';

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
  notePlatformProvider: NotePlatformProvider,
  siblings: Array<Record<string, unknown>>,
  sectionHeading: string,
  sectionOccurrence: number,
): SectionRange | null {
  const headings = collectHeadings(notePlatformProvider, siblings);
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
  notePlatformProvider: NotePlatformProvider,
  siblings: Array<Record<string, unknown>>,
  headingPath: string[],
  sectionOccurrence: number,
): SectionRange | null {
  const headings = collectHeadings(notePlatformProvider, siblings);
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
  notePlatformProvider: NotePlatformProvider,
  siblings: Array<Record<string, unknown>>,
): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  for (let i = 0; i < siblings.length; i += 1) {
    const block = siblings[i];
    const level = notePlatformProvider.extractHeadingLevel(block);
    if (level === undefined) continue;
    const text = notePlatformProvider.extractBlockText(block);
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
