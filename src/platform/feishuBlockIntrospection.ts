import type { NotePlatformBlockKind } from "./types.js";

export function extractBlockType(
  block: Record<string, unknown>,
): number | undefined {
  const value = block.block_type;
  return typeof value === "number" ? value : undefined;
}

export function extractBlockKind(
  block: Record<string, unknown>,
): NotePlatformBlockKind {
  const blockType = extractBlockType(block);
  if (blockType !== undefined) {
    if (blockType >= 3 && blockType <= 11) return "heading";
    if (blockType === 2) return "text";
    if (blockType === 12) return "bullet";
    if (blockType === 13) return "ordered";
    if (blockType === 14) return "code";
    if (blockType === 15) return "quote";
    if (blockType === 27) return "image";
    if (blockType === 31) return "table";
    if (blockType === 1) return "page";
  }

  if (hasObjectField(block, "text")) return "text";
  if (hasObjectField(block, "ordered")) return "ordered";
  if (hasObjectField(block, "bullet")) return "bullet";
  if (hasObjectField(block, "quote")) return "quote";
  if (hasObjectField(block, "code")) return "code";
  if (hasObjectField(block, "image")) return "image";
  if (hasObjectField(block, "table")) return "table";
  if (hasObjectField(block, "page")) return "page";
  if (extractHeadingLevel(block) !== undefined) return "heading";
  return "unknown";
}

export function extractBlockId(
  block: Record<string, unknown>,
): string | undefined {
  return typeof block.block_id === "string" && block.block_id.trim().length > 0
    ? block.block_id.trim()
    : undefined;
}

export function extractChildIds(block: Record<string, unknown>): string[] {
  const children = block.children;
  if (!Array.isArray(children)) {
    return [];
  }
  return children.filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

export function extractHeadingLevel(
  block: Record<string, unknown>,
): number | undefined {
  for (let level = 1; level <= 9; level += 1) {
    if (hasObjectField(block, `heading${level}`)) {
      return level;
    }
  }

  const blockType = extractBlockType(block);
  if (blockType !== undefined && blockType >= 3 && blockType <= 11) {
    return blockType - 2;
  }
  return undefined;
}

export function extractBlockText(block: Record<string, unknown>): string {
  const textContainer = extractTextContainer(block);
  if (!textContainer) return "";
  const elements = textContainer.elements;
  if (!Array.isArray(elements)) return "";

  let text = "";
  for (const element of elements) {
    if (!element || typeof element !== "object") continue;
    const record = element as Record<string, unknown>;
    const textRun = record.text_run;
    if (textRun && typeof textRun === "object") {
      const content = (textRun as Record<string, unknown>).content;
      if (typeof content === "string") {
        text += content;
      }
      continue;
    }
    const equation = record.equation;
    if (equation && typeof equation === "object") {
      const content = (equation as Record<string, unknown>).content;
      if (typeof content === "string") {
        text += content;
      }
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
    "quote",
    "code",
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

function hasObjectField(block: Record<string, unknown>, key: string): boolean {
  return Boolean(block[key] && typeof block[key] === "object");
}
