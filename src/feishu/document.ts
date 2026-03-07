export function extractDocumentId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  const docxMatch = value.match(/\/docx\/([a-zA-Z0-9_-]+)/i);
  const docsMatch = value.match(/\/docs\/([a-zA-Z0-9_-]+)/i);
  const apiMatch = value.match(/\/documents\/([a-zA-Z0-9_-]+)/i);
  const directMatch = value.match(/^([a-zA-Z0-9_-]{10,})$/);

  const token = docxMatch?.[1] ?? docsMatch?.[1] ?? apiMatch?.[1] ?? directMatch?.[1];
  return token ?? null;
}

export function extractWikiToken(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  const wikiMatch = value.match(/\/wiki\/([a-zA-Z0-9_-]+)/i);
  const directMatch = value.match(/^([a-zA-Z0-9_-]{10,})$/);
  const token = wikiMatch?.[1] ?? directMatch?.[1];
  if (!token) return null;

  return token.split("?")[0];
}

export function detectDocumentType(input: string): "document" | "wiki" {
  return input.includes("/wiki/") ? "wiki" : "document";
}

