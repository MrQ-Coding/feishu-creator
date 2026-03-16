import {
  findSectionRangeByHeadingPath,
  findSectionRangeByHeadingText,
  type SectionRange,
} from "./sectionRange.js";
import type {
  NotePlatformDocumentGateway,
  NotePlatformProvider,
} from "../../platform/index.js";

export interface ProgressiveLocateSectionInput {
  documentId: string;
  parentBlockId: string;
  sectionHeading?: string;
  headingPath: string[];
  sectionOccurrence: number;
  pageSize: number;
}

export interface ProgressiveLocateSectionResult {
  range: SectionRange;
  scannedChildrenCount: number;
  scannedAllChildren: boolean;
  siblings?: Array<Record<string, unknown>>;
}

export async function locateSectionRangeByProgressiveScan(
  documentGateway: NotePlatformDocumentGateway,
  notePlatformProvider: NotePlatformProvider,
  input: ProgressiveLocateSectionInput,
): Promise<ProgressiveLocateSectionResult | null> {
  const siblings: Array<Record<string, unknown>> = [];
  let pageToken: string | undefined;

  while (true) {
    const page = await documentGateway.listBlockChildren(
      input.documentId,
      input.parentBlockId,
      {
        pageSize: input.pageSize,
        pageToken,
        documentRevisionId: -1,
      },
    );

    if (page.items.length > 0) {
      siblings.push(...page.items);
    }

    const range =
      input.headingPath.length > 0
        ? findSectionRangeByHeadingPath(
            notePlatformProvider,
            siblings,
            input.headingPath,
            input.sectionOccurrence,
          )
        : findSectionRangeByHeadingText(
            notePlatformProvider,
            siblings,
            input.sectionHeading as string,
            input.sectionOccurrence,
          );
    const hasMore = page.hasMore;

    if (range && (range.endIndex < siblings.length || !hasMore)) {
      return {
        range,
        scannedChildrenCount: siblings.length,
        scannedAllChildren: !hasMore,
        siblings: !hasMore ? [...siblings] : undefined,
      };
    }

    if (!hasMore) return null;
    if (!page.pageToken) {
      throw new Error(
        "Document children pagination returned hasMore=true without pageToken.",
      );
    }
    pageToken = page.pageToken;
  }
}
