import { locateSectionRangeByProgressiveScan, type ProgressiveLocateSectionResult } from './sectionLocator.js';
import type { DocumentEditRuntime } from './context.js';
import {
  buildLocateCacheKey,
  clampPageSize,
  locateWithinSiblings,
  normalizeHeadingPath,
  normalizeSectionOccurrence,
} from './helpers.js';
import type {
  LocateSectionRangeInput,
  LocateSectionRangeResult,
} from './types.js';

export interface HeadingTargetInput {
  parentBlockId: string;
  sectionHeading?: string;
  headingPath: string[];
  sectionOccurrence: number;
}

interface LocateRuntimeInput extends HeadingTargetInput {
  documentId: string;
  pageSize: number;
}

export interface ResolvedHeadingTarget extends HeadingTargetInput {
  documentId: string;
  locateResult: ProgressiveLocateSectionResult;
}

export async function locateSectionRangeCached(
  runtime: DocumentEditRuntime,
  input: LocateRuntimeInput,
): Promise<ProgressiveLocateSectionResult | null> {
  const cacheKey = buildLocateCacheKey(input);
  const cachedResult = runtime.locateCache.get(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  const cachedChildren = runtime.documentBlockService.peekChildren(
    input.documentId,
    input.parentBlockId,
  );
  if (cachedChildren) {
    const result = locateWithinSiblings(runtime.notePlatformProvider, cachedChildren, input);
    if (result) {
      runtime.locateCache.set(cacheKey, result);
    }
    return result;
  }

  const result = await locateSectionRangeByProgressiveScan(
    runtime.notePlatformDocumentGateway,
    runtime.notePlatformProvider,
    input,
  );
  if (result?.siblings) {
    runtime.documentBlockService.seedChildren(
      input.documentId,
      input.parentBlockId,
      result.siblings,
    );
  }
  if (result) {
    runtime.locateCache.set(cacheKey, result);
  }
  return result;
}

export async function resolveHeadingTarget(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: {
    parentBlockId?: string;
    sectionHeading?: string;
    headingPath?: string[];
    sectionOccurrence?: number;
    pageSize?: number;
  },
): Promise<ResolvedHeadingTarget> {
  const parentBlockId = input.parentBlockId?.trim() || normalizedDocumentId;
  const sectionHeading = input.sectionHeading?.trim();
  const headingPath = normalizeHeadingPath(input.headingPath);
  if (!sectionHeading && headingPath.length === 0) {
    throw new Error('Either sectionHeading or headingPath is required.');
  }

  const sectionOccurrence = normalizeSectionOccurrence(input.sectionOccurrence);
  const locateResult = await locateSectionRangeCached(runtime, {
    documentId: normalizedDocumentId,
    parentBlockId,
    sectionHeading,
    headingPath,
    sectionOccurrence,
    pageSize: clampPageSize(input.pageSize),
  });

  if (!locateResult) {
    throwHeadingNotFound(sectionHeading, headingPath, sectionOccurrence);
  }

  return {
    documentId: normalizedDocumentId,
    parentBlockId,
    sectionHeading,
    headingPath,
    sectionOccurrence,
    locateResult,
  };
}

export async function locateSectionRangeCore(
  runtime: DocumentEditRuntime,
  normalizedDocumentId: string,
  input: LocateSectionRangeInput,
): Promise<LocateSectionRangeResult> {
  const target = await resolveHeadingTarget(runtime, normalizedDocumentId, input);
  return {
    documentId: normalizedDocumentId,
    parentBlockId: target.parentBlockId,
    sectionHeading: target.locateResult.range.headingText,
    sectionOccurrence: target.sectionOccurrence,
    startIndex: target.locateResult.range.startIndex,
    endIndex: target.locateResult.range.endIndex,
    scannedChildrenCount: target.locateResult.scannedChildrenCount,
    scannedAllChildren: target.locateResult.scannedAllChildren,
  };
}

export function throwHeadingNotFound(
  sectionHeading: string | undefined,
  headingPath: string[],
  sectionOccurrence: number,
): never {
  const locateText =
    headingPath.length > 0
      ? `headingPath=${JSON.stringify(headingPath)}`
      : `sectionHeading="${sectionHeading}"`;
  throw new Error(`Section heading not found: ${locateText} (occurrence=${sectionOccurrence}).`);
}
