import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, "..", "..");
const DEFAULT_INDEX_PATH = path.join(projectRoot, ".knowledge", "index.json");

// ──────────── Storage Types (compact, on-disk) ────────────

export interface IndexSection {
  id: string;
  title: string;
  keywords: string[];
  summary: string;
  createdAt: string;
}

export interface IndexDocument {
  documentId: string;
  category: string;
  sections: IndexSection[];
}

export interface IndexSpace {
  spaceId: string;
  documents: IndexDocument[];
}

export interface KnowledgeIndex {
  version: number;
  updatedAt: string;
  spaces: IndexSpace[];
}

// ──────────── Flat entry (used by search & external API) ────────────

export interface KnowledgeIndexEntry {
  id: string;
  title: string;
  keywords: string[];
  category?: string;
  spaceId?: string;
  documentId: string;
  sectionHeading: string;
  summary: string;
  createdAt: string;
}

export interface IndexSearchResult {
  entry: KnowledgeIndexEntry;
  score: number;
}

const INDEX_VERSION = 2;

export class KnowledgeIndexStore {
  private readonly indexPath: string;

  constructor(indexPath?: string) {
    this.indexPath = indexPath ?? DEFAULT_INDEX_PATH;
  }

  load(): KnowledgeIndex {
    if (!existsSync(this.indexPath)) {
      return this.emptyIndex();
    }
    try {
      const raw = readFileSync(this.indexPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      // Migrate v1 flat format → v2
      if (parsed.version === 1 && Array.isArray(parsed.entries)) {
        return this.migrateV1(parsed as unknown as V1Index);
      }
      if (parsed.version !== INDEX_VERSION) {
        return this.emptyIndex();
      }
      return parsed as unknown as KnowledgeIndex;
    } catch {
      return this.emptyIndex();
    }
  }

  save(index: KnowledgeIndex): void {
    const dir = path.dirname(this.indexPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    index.updatedAt = new Date().toISOString();
    writeFileSync(this.indexPath, JSON.stringify(index, null, 2), "utf-8");
  }

  addEntry(entry: KnowledgeIndexEntry): void {
    const index = this.load();
    const space = this.ensureSpace(index, entry.spaceId ?? "_default");
    const doc = this.ensureDocument(space, entry.documentId, entry.category ?? "");

    // Deduplicate by id
    doc.sections = doc.sections.filter((s) => s.id !== entry.id);
    doc.sections.push({
      id: entry.id,
      title: entry.title,
      keywords: entry.keywords,
      summary: entry.summary,
      createdAt: entry.createdAt,
    });
    this.save(index);
  }

  removeEntry(entryId: string): boolean {
    const index = this.load();
    let found = false;
    for (const space of index.spaces) {
      for (const doc of space.documents) {
        const before = doc.sections.length;
        doc.sections = doc.sections.filter((s) => s.id !== entryId);
        if (doc.sections.length < before) {
          found = true;
        }
      }
    }
    if (found) {
      this.cleanupEmpty(index);
      this.save(index);
    }
    return found;
  }

  search(query: string, maxResults: number = 5): IndexSearchResult[] {
    const index = this.load();
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) {
      return [];
    }

    const scored: IndexSearchResult[] = [];

    for (const space of index.spaces) {
      for (const doc of space.documents) {
        // Pre-tokenize shared fields once per document
        const categoryTokens = this.tokenize(doc.category);

        for (const section of doc.sections) {
          const score = this.computeScore(queryTokens, section, categoryTokens);
          if (score > 0) {
            scored.push({
              entry: {
                id: section.id,
                title: section.title,
                keywords: section.keywords,
                category: doc.category,
                spaceId: space.spaceId,
                documentId: doc.documentId,
                sectionHeading: section.title,
                summary: section.summary,
                createdAt: section.createdAt,
              },
              score,
            });
          }
        }
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults);
  }

  replaceAll(entries: KnowledgeIndexEntry[], spaceId?: string): void {
    const index = this.emptyIndex();
    for (const entry of entries) {
      const sid = entry.spaceId ?? spaceId ?? "_default";
      const space = this.ensureSpace(index, sid);
      const doc = this.ensureDocument(space, entry.documentId, entry.category ?? "");
      doc.sections.push({
        id: entry.id,
        title: entry.title,
        keywords: entry.keywords,
        summary: entry.summary,
        createdAt: entry.createdAt,
      });
    }
    this.save(index);
  }

  replaceBySpace(spaceId: string, entries: KnowledgeIndexEntry[]): void {
    const index = this.load();
    // Remove the old space data
    index.spaces = index.spaces.filter((s) => s.spaceId !== spaceId);
    // Build new space
    const space: IndexSpace = { spaceId, documents: [] };
    for (const entry of entries) {
      const doc = this.ensureDocument(space, entry.documentId, entry.category ?? "");
      doc.sections.push({
        id: entry.id,
        title: entry.title,
        keywords: entry.keywords,
        summary: entry.summary,
        createdAt: entry.createdAt,
      });
    }
    if (space.documents.length > 0) {
      index.spaces.push(space);
    }
    this.save(index);
  }

  getIndexPath(): string {
    return this.indexPath;
  }

  // ──────────── Private helpers ────────────

  private ensureSpace(index: KnowledgeIndex, spaceId: string): IndexSpace {
    let space = index.spaces.find((s) => s.spaceId === spaceId);
    if (!space) {
      space = { spaceId, documents: [] };
      index.spaces.push(space);
    }
    return space;
  }

  private ensureDocument(space: IndexSpace, documentId: string, category: string): IndexDocument {
    let doc = space.documents.find((d) => d.documentId === documentId);
    if (!doc) {
      doc = { documentId, category, sections: [] };
      space.documents.push(doc);
    }
    return doc;
  }

  private cleanupEmpty(index: KnowledgeIndex): void {
    for (const space of index.spaces) {
      space.documents = space.documents.filter((d) => d.sections.length > 0);
    }
    index.spaces = index.spaces.filter((s) => s.documents.length > 0);
  }

  private computeScore(
    queryTokens: string[],
    section: IndexSection,
    categoryTokens: string[],
  ): number {
    const titleTokens = this.tokenize(section.title);
    const keywordTokens = section.keywords.flatMap((k) => this.tokenize(k));
    const summaryTokens = this.tokenize(section.summary);

    let score = 0;

    for (const qt of queryTokens) {
      // Exact keyword match (highest weight)
      if (keywordTokens.some((kt) => kt === qt)) {
        score += 10;
      } else if (keywordTokens.some((kt) => kt.includes(qt) || qt.includes(kt))) {
        score += 6;
      }

      // Title match
      if (titleTokens.some((tt) => tt === qt)) {
        score += 8;
      } else if (titleTokens.some((tt) => tt.includes(qt) || qt.includes(tt))) {
        score += 4;
      }

      // Category match
      if (categoryTokens.some((ct) => ct === qt)) {
        score += 3;
      }

      // Summary match
      if (summaryTokens.some((st) => st === qt)) {
        score += 2;
      } else if (summaryTokens.some((st) => st.includes(qt) || qt.includes(st))) {
        score += 1;
      }
    }

    return score;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0);
  }

  private emptyIndex(): KnowledgeIndex {
    return {
      version: INDEX_VERSION,
      updatedAt: new Date().toISOString(),
      spaces: [],
    };
  }

  // ──────────── v1 Migration ────────────

  private migrateV1(v1: V1Index): KnowledgeIndex {
    const index = this.emptyIndex();
    for (const entry of v1.entries) {
      const sid = entry.spaceId ?? v1.spaceId ?? "_default";
      const space = this.ensureSpace(index, sid);
      const doc = this.ensureDocument(space, entry.documentId, entry.category ?? "");
      doc.sections.push({
        id: entry.id,
        title: entry.title,
        keywords: entry.keywords ?? [],
        summary: entry.summary ?? "",
        createdAt: entry.createdAt ?? "",
      });
    }
    // Auto-save migrated format
    this.save(index);
    return index;
  }
}

interface V1Index {
  version: 1;
  spaceId?: string;
  updatedAt: string;
  entries: Array<{
    id: string;
    title: string;
    keywords: string[];
    category?: string;
    spaceId?: string;
    documentId: string;
    summary: string;
    createdAt: string;
  }>;
}
