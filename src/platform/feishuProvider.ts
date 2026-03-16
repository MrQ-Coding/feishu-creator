import {
  detectDocumentType,
  extractDocumentId,
  extractWikiToken,
} from "../feishu/document.js";
import {
  extractBlockId,
  extractBlockKind,
  extractBlockText,
  extractBlockType,
  extractChildIds,
  extractHeadingLevel,
} from "./feishuBlockIntrospection.js";
import {
  extractImageBlockData,
  sanitizeBlockForCopy,
} from "./feishuBlockCopying.js";
import {
  buildBulletBlock,
  buildHeadingBlock,
  buildOrderedBlock,
  buildRichTextChildren,
  buildTextBlock,
} from "./feishuRichTextBlocks.js";
import { buildTableBlock } from "./feishuTableBlocks.js";
import type { NotePlatformProvider } from "./types.js";

export class FeishuNotePlatformProvider implements NotePlatformProvider {
  readonly id = "feishu";

  extractDocumentId(input: string): string | null {
    return extractDocumentId(input);
  }

  extractWikiToken(input: string): string | null {
    return extractWikiToken(input);
  }

  detectDocumentType(input: string): "document" | "wiki" {
    return detectDocumentType(input);
  }

  extractBlockType = extractBlockType;

  extractBlockKind = extractBlockKind;

  extractBlockId = extractBlockId;

  extractChildIds = extractChildIds;

  extractHeadingLevel = extractHeadingLevel;

  extractBlockText = extractBlockText;

  sanitizeBlockForCopy = sanitizeBlockForCopy;

  extractImageBlockData = extractImageBlockData;

  buildRichTextChildren = buildRichTextChildren;

  buildHeadingBlock(level: number, text: string): Record<string, unknown> {
    return buildHeadingBlock(level, text);
  }

  buildTextBlock(text: string): Record<string, unknown> {
    return buildTextBlock(text);
  }

  buildOrderedBlock(text: string): Record<string, unknown> {
    return buildOrderedBlock(text);
  }

  buildBulletBlock(text: string): Record<string, unknown> {
    return buildBulletBlock(text);
  }

  buildTableBlock(rowSize: number, columnSize: number): Record<string, unknown> {
    return buildTableBlock(rowSize, columnSize);
  }

  buildImageBlock(width: number, height: number): Record<string, unknown> {
    return {
      block_type: 27,
      image: {
        width,
        height,
        token: "",
      },
    };
  }
}
