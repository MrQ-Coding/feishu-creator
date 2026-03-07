import { createHash, randomUUID } from 'node:crypto';
import {
  findSectionRangeByHeadingPath,
  findSectionRangeByHeadingText,
} from './sectionRange.js';
import type { ProgressiveLocateSectionResult } from './sectionLocator.js';
import type { TextElementInput, TextElementStyle } from './types.js';

export const DEFAULT_CHUNK_SIZE = 50;
export const MAX_CHUNK_SIZE = 50;
export const DEFAULT_MIN_CHUNK_SIZE = 5;
export const MIN_CHUNK_SIZE = 1;
export const CHUNK_GROWTH_STEP = 5;

export function normalizeOptionalIndex(index?: number): number | undefined {
  if (index === undefined || index === null) return undefined;
  if (!Number.isFinite(index)) {
    throw new Error('index must be a finite integer.');
  }
  const normalized = Math.floor(index);
  if (normalized < 0) {
    throw new Error('index must be greater than or equal to 0.');
  }
  return normalized;
}

export function normalizeSectionOccurrence(sectionOccurrence?: number): number {
  if (sectionOccurrence === undefined || sectionOccurrence === null) return 1;
  if (!Number.isFinite(sectionOccurrence)) {
    throw new Error('sectionOccurrence must be a finite integer.');
  }
  const normalized = Math.floor(sectionOccurrence);
  if (normalized < 1) {
    throw new Error('sectionOccurrence must be greater than or equal to 1.');
  }
  return normalized;
}

export function normalizeHeadingLevel(headingLevel?: number): number {
  if (headingLevel === undefined || headingLevel === null) return 2;
  if (!Number.isFinite(headingLevel)) {
    throw new Error('headingLevel must be a finite integer.');
  }
  const normalized = Math.floor(headingLevel);
  if (normalized < 1 || normalized > 9) {
    throw new Error('headingLevel must be within [1, 9].');
  }
  return normalized;
}

export function normalizeOptionalNonNegativeInt(
  value: number | undefined,
  field: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isFinite(value)) {
    throw new Error(`${field} must be a finite integer.`);
  }
  const normalized = Math.floor(value);
  if (normalized < 0) {
    throw new Error(`${field} must be greater than or equal to 0.`);
  }
  return normalized;
}

export function normalizeRevisionId(revisionId?: number): number {
  if (revisionId === undefined || revisionId === null) return -1;
  if (!Number.isFinite(revisionId)) {
    throw new Error('documentRevisionId must be a finite integer.');
  }
  const normalized = Math.floor(revisionId);
  if (normalized < -1) {
    throw new Error('documentRevisionId must be -1 or greater.');
  }
  return normalized;
}

export function normalizeRequiredIndex(value: number, fieldName: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite integer.`);
  }
  const normalized = Math.floor(value);
  if (normalized < 0) {
    throw new Error(`${fieldName} must be greater than or equal to 0.`);
  }
  return normalized;
}

export function clampChunkSize(chunkSize?: number): number {
  if (!Number.isFinite(chunkSize)) {
    return DEFAULT_CHUNK_SIZE;
  }
  return Math.max(1, Math.min(MAX_CHUNK_SIZE, Math.floor(chunkSize as number)));
}

export function clampMinChunkSize(
  minChunkSize: number | undefined,
  chunkSize: number,
): number {
  if (!Number.isFinite(minChunkSize)) {
    return Math.max(MIN_CHUNK_SIZE, Math.min(DEFAULT_MIN_CHUNK_SIZE, chunkSize));
  }
  return Math.max(MIN_CHUNK_SIZE, Math.min(chunkSize, Math.floor(minChunkSize as number)));
}

export function normalizeResumeFromCreatedCount(
  resumeFromCreatedCount: number | undefined,
  totalRequested: number,
): number {
  if (resumeFromCreatedCount === undefined || resumeFromCreatedCount === null) {
    return 0;
  }
  if (!Number.isFinite(resumeFromCreatedCount)) {
    throw new Error('resumeFromCreatedCount must be a finite integer.');
  }
  const normalized = Math.floor(resumeFromCreatedCount);
  if (normalized < 0 || normalized > totalRequested) {
    throw new Error(`resumeFromCreatedCount must be within [0, ${totalRequested}].`);
  }
  return normalized;
}

export function normalizeOptionalTokenSeed(seed?: string): string | undefined {
  if (typeof seed !== 'string') return undefined;
  const trimmed = seed.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function buildClientToken(
  checkpointTokenSeed: string | undefined,
  startOffset: number,
  requestCount: number,
): string {
  if (!checkpointTokenSeed) return randomUUID();
  const digest = createHash('sha1')
    .update(`${checkpointTokenSeed}:${startOffset}:${requestCount}`)
    .digest('hex')
    .slice(0, 32);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
}

export function isAdaptiveChunkingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('http 429') ||
    message.includes('http 413') ||
    message.includes('http 500') ||
    message.includes('http 502') ||
    message.includes('http 503') ||
    message.includes('http 504') ||
    message.includes('code=99991672') ||
    message.includes('too many requests') ||
    message.includes('throttl')
  );
}

export function clampPageSize(pageSize?: number): number {
  if (!Number.isFinite(pageSize)) return 200;
  return Math.max(1, Math.min(500, Math.floor(pageSize as number)));
}

export function normalizeHeadingPath(headingPath?: string[]): string[] {
  if (!Array.isArray(headingPath)) return [];
  return headingPath.map((item) => item.trim()).filter((item) => item.length > 0);
}

export function normalizeTextItems(items?: string[]): string[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => item.trim()).filter((item) => item.length > 0);
}

export function isNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('http 404') ||
    message.includes('code=1770002') ||
    message.includes('code=1061045') ||
    message.includes('code=131005') ||
    message.includes('not found')
  );
}

export function isPermissionDeniedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('http 403') ||
    message.includes('code=1061004') ||
    message.includes('forbidden')
  );
}

export function buildLocateCacheKey(input: {
  documentId: string;
  parentBlockId: string;
  sectionHeading?: string;
  headingPath: string[];
  sectionOccurrence: number;
}): string {
  const selector =
    input.headingPath.length > 0
      ? `path=${input.headingPath.join(' > ')}`
      : `heading=${input.sectionHeading ?? ''}`;
  return [
    `locate:${input.documentId}`,
    `parent=${input.parentBlockId}`,
    selector,
    `occurrence=${input.sectionOccurrence}`,
  ].join(':');
}

export function locateWithinSiblings(
  siblings: Array<Record<string, unknown>>,
  input: {
    sectionHeading?: string;
    headingPath: string[];
    sectionOccurrence: number;
  },
): ProgressiveLocateSectionResult | null {
  const range =
    input.headingPath.length > 0
      ? findSectionRangeByHeadingPath(siblings, input.headingPath, input.sectionOccurrence)
      : findSectionRangeByHeadingText(
          siblings,
          input.sectionHeading as string,
          input.sectionOccurrence,
        );
  if (!range) {
    return null;
  }
  return {
    range,
    scannedChildrenCount: siblings.length,
    scannedAllChildren: true,
    siblings,
  };
}

export function buildUpdateTextElement(input: TextElementInput): Record<string, unknown> {
  const style = buildTextElementStyle(input.style);
  if (typeof input.equation === 'string') {
    return {
      equation: {
        content: input.equation,
        text_element_style: style,
      },
    };
  }

  if (typeof input.text === 'string') {
    return {
      text_run: {
        content: input.text,
        text_element_style: style,
      },
    };
  }

  throw new Error('Each text element must include either text or equation.');
}

export function extractBlockIds(items: Array<Record<string, unknown>>): string[] {
  const ids: string[] = [];
  for (const item of items) {
    const value = item.block_id;
    if (typeof value === 'string' && value) {
      ids.push(value);
    }
  }
  return ids;
}

function buildTextElementStyle(style?: TextElementStyle): Record<string, unknown> {
  return {
    bold: Boolean(style?.bold),
    italic: Boolean(style?.italic),
    underline: Boolean(style?.underline),
    strikethrough: Boolean(style?.strikethrough),
    inline_code: Boolean(style?.inline_code),
    text_color:
      typeof style?.text_color === 'number' ? Math.floor(style.text_color) : undefined,
    background_color:
      typeof style?.background_color === 'number'
        ? Math.floor(style.background_color)
        : undefined,
  };
}
