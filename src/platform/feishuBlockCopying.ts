import type { NotePlatformImageBlockData } from "./types.js";
import { extractBlockId, extractBlockType } from "./feishuBlockIntrospection.js";

const BLOCK_METADATA_KEYS = new Set([
  "block_id",
  "parent_id",
  "children",
  "children_ids",
  "document_id",
  "revision_id",
  "version",
  "depth",
  "deleted",
  "create_time",
  "created_time",
  "update_time",
  "updated_time",
  "modified_time",
  "page_id",
  "page_token",
  "parent_index",
  "child_count",
  "last_editor",
  "creator",
  "owner_id",
]);

export function sanitizeBlockForCopy(
  block: Record<string, unknown>,
): Record<string, unknown> {
  const blockType = extractBlockType(block);
  if (blockType === undefined) {
    throw new Error("Source block is missing block_type.");
  }

  const payload: Record<string, unknown> = { block_type: blockType };
  for (const [key, value] of Object.entries(block)) {
    if (key === "block_type" || BLOCK_METADATA_KEYS.has(key)) continue;
    if (value === undefined) continue;
    payload[key] = structuredClone(value);
  }
  return payload;
}

export function extractImageBlockData(
  block: Record<string, unknown>,
): NotePlatformImageBlockData {
  const image = block.image;
  if (!image || typeof image !== "object") {
    throw new Error(`Image block is missing image payload: ${describeBlock(block)}.`);
  }

  const token = (image as Record<string, unknown>).token;
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new Error(`Image block is missing image token: ${describeBlock(block)}.`);
  }

  const width = coercePositiveInt((image as Record<string, unknown>).width);
  const height = coercePositiveInt((image as Record<string, unknown>).height);
  if (!width || !height) {
    throw new Error(`Image block is missing width/height: ${describeBlock(block)}.`);
  }

  return {
    token: token.trim(),
    width,
    height,
  };
}

function describeBlock(block: Record<string, unknown>): string {
  const blockId = extractBlockId(block) ?? "<no-block-id>";
  const blockType = extractBlockType(block);
  return `${blockId}:${blockType ?? "unknown"}`;
}

function coercePositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}
