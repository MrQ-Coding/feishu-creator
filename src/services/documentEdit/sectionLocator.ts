import type { FeishuClient } from "../../feishu/client.js";
import {
  findSectionRangeByHeadingPath,
  findSectionRangeByHeadingText,
  type SectionRange,
} from "./sectionRange.js";

interface DocumentBlockChildrenListResponse {
  items?: Array<Record<string, unknown>>;
  has_more?: boolean;
  page_token?: string;
}

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
  feishuClient: FeishuClient,
  input: ProgressiveLocateSectionInput,
): Promise<ProgressiveLocateSectionResult | null> {
  const siblings: Array<Record<string, unknown>> = [];
  let pageToken: string | undefined;

  while (true) {
    const data = await feishuClient.request<DocumentBlockChildrenListResponse>(
      `/docx/v1/documents/${input.documentId}/blocks/${input.parentBlockId}/children`,
      "GET",
      undefined,
      {
        page_size: input.pageSize,
        page_token: pageToken,
        document_revision_id: -1,
      },
    );

    if (Array.isArray(data.items) && data.items.length > 0) {
      siblings.push(...data.items);
    }

    const range =
      input.headingPath.length > 0
        ? findSectionRangeByHeadingPath(
            siblings,
            input.headingPath,
            input.sectionOccurrence,
          )
        : findSectionRangeByHeadingText(
            siblings,
            input.sectionHeading as string,
            input.sectionOccurrence,
          );
    const hasMore = Boolean(data.has_more);

    if (range && (range.endIndex < siblings.length || !hasMore)) {
      return {
        range,
        scannedChildrenCount: siblings.length,
        scannedAllChildren: !hasMore,
        siblings: !hasMore ? [...siblings] : undefined,
      };
    }

    if (!hasMore) return null;
    if (!data.page_token) {
      throw new Error(
        "Feishu children pagination returned has_more=true without page_token.",
      );
    }
    pageToken = data.page_token;
  }
}
