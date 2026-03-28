import { randomUUID } from "node:crypto";
import type { MarkdownDocumentService } from "../markdown/index.js";
import type { SearchService } from "../search/index.js";
import type { DocumentCreateService } from "../document/index.js";
import type { DocumentEditService } from "../documentEdit/index.js";
import type { WikiTreeService, WikiTreeNode } from "../wiki/index.js";
import type { FeishuAuthManager } from "../../feishu/authManager.js";
import {
  KnowledgeIndexStore,
  type KnowledgeIndexEntry,
  type IndexSearchResult,
} from "./indexStore.js";
import type { RichTextBlockSpec } from "../documentEdit/richTextBlocks.js";

// ──────────────────── Input / Output Types ────────────────────

export interface KnowledgeSearchInput {
  query: string;
  spaceId?: string;
  fallbackToApi?: boolean;
  includeContent?: boolean;
  maxResults?: number;
}

export interface KnowledgeSearchResultItem {
  title: string;
  documentId: string;
  sectionHeading: string;
  summary: string;
  keywords: string[];
  category?: string;
  content?: string;
}

export interface KnowledgeSearchResult {
  source: "index" | "api" | "none";
  found: boolean;
  results: KnowledgeSearchResultItem[];
}

export interface KnowledgeRecordInput {
  spaceId: string;
  documentId?: string;
  category?: string;
  parentNodeToken?: string;
  title: string;
  keywords: string[];
  problem: string;
  solution: string;
  reference?: string;
}

export interface KnowledgeRecordResult {
  documentId: string;
  sectionHeading: string;
  indexEntryId: string;
  created: boolean;
}

export interface KnowledgeIndexRebuildInput {
  spaceId: string;
  rootNodeToken?: string;
  maxDepth?: number;
}

export interface KnowledgeIndexRebuildResult {
  spaceId: string;
  totalDocuments: number;
  totalEntries: number;
  indexPath: string;
}

// ──────────────────── Service ────────────────────

export class KnowledgeService {
  private readonly indexStore: KnowledgeIndexStore;

  constructor(
    private readonly searchService: SearchService,
    private readonly markdownService: MarkdownDocumentService,
    private readonly documentCreateService: DocumentCreateService,
    private readonly documentEditService: DocumentEditService,
    private readonly wikiTreeService: WikiTreeService,
    private readonly authManager: FeishuAuthManager,
    indexPath?: string,
  ) {
    this.indexStore = new KnowledgeIndexStore(indexPath);
  }

  // ──────── knowledge_search ────────

  async search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult> {
    const query = input.query.trim();
    if (!query) {
      throw new Error("query is required.");
    }
    const maxResults = input.maxResults ?? 5;
    const includeContent = input.includeContent ?? true;

    // Step 1: Search local index
    const indexResults = this.indexStore.search(query, maxResults);

    if (indexResults.length > 0) {
      const items = await this.enrichResults(indexResults, includeContent);
      return { source: "index", found: true, results: items };
    }

    // Step 2: Fallback to Feishu API if enabled
    if (input.fallbackToApi) {
      const authType = this.authManager.getStatus().effectiveAuthType;
      const apiResult = await this.searchService.search({
        searchKey: query,
        searchType: "both",
        spaceId: input.spaceId,
        authType,
      });

      const allItems = [...(apiResult.documents ?? []), ...(apiResult.wikis ?? [])];
      if (allItems.length > 0) {
        const items: KnowledgeSearchResultItem[] = [];
        for (const item of allItems.slice(0, maxResults)) {
          let content: string | undefined;
          if (includeContent && item.documentId) {
            try {
              const md = await this.markdownService.exportMarkdown({
                documentId: item.documentId,
              });
              content = md.markdown;
            } catch {
              // Content fetch failed, return without content
            }
          }
          items.push({
            title: item.title ?? "Untitled",
            documentId: item.documentId ?? "",
            sectionHeading: item.title ?? "",
            summary: item.title ?? "",
            keywords: [],
            content,
          });
        }
        return { source: "api", found: true, results: items };
      }
    }

    return { source: "none", found: false, results: [] };
  }

  // ──────── knowledge_record ────────

  async record(input: KnowledgeRecordInput): Promise<KnowledgeRecordResult> {
    const title = input.title.trim();
    if (!title) throw new Error("title is required.");
    if (!input.problem.trim()) throw new Error("problem is required.");
    if (!input.solution.trim()) throw new Error("solution is required.");
    if (!input.keywords.length) throw new Error("keywords must not be empty.");

    let documentId = input.documentId?.trim();
    let created = false;

    // If no documentId, find or create document by category
    if (!documentId) {
      const category = input.category?.trim() || "知识库";
      documentId = await this.findDocumentByTitle(input.spaceId, category);

      if (!documentId) {
        // Create new document
        const result = await this.documentCreateService.createDocument({
          title: category,
          wikiContext: {
            spaceId: input.spaceId,
            parentNodeToken: input.parentNodeToken,
          },
        });
        documentId = result.documentId;
        created = true;
      }
    }

    // Build section content
    const sectionHeading = title;
    const today = new Date().toISOString().slice(0, 10);
    const keywordsLine = input.keywords.join(", ");

    const blocks: RichTextBlockSpec[] = [
      { type: "text", text: `**关键词**: ${keywordsLine}` },
      { type: "text", text: `**日期**: ${today}` },
      { type: "heading", text: "问题描述", headingLevel: 3 },
      { type: "text", text: input.problem },
      { type: "heading", text: "解决方案", headingLevel: 3 },
      { type: "text", text: input.solution },
    ];

    if (input.reference?.trim()) {
      blocks.push(
        { type: "heading", text: "参考", headingLevel: 3 },
        { type: "text", text: input.reference },
      );
    }

    // Write to document using upsert_section
    await this.documentEditService.upsertSection({
      documentId,
      sectionHeading,
      headingLevel: 2,
      blocks,
    });

    // Update local index
    const entryId = `entry-${randomUUID().slice(0, 8)}`;
    const summaryText =
      input.solution.length > 100
        ? input.solution.slice(0, 100) + "..."
        : input.solution;

    this.indexStore.addEntry({
      id: entryId,
      title,
      keywords: input.keywords,
      category: input.category,
      documentId,
      sectionHeading,
      summary: summaryText,
      createdAt: today,
    });

    return {
      documentId,
      sectionHeading,
      indexEntryId: entryId,
      created,
    };
  }

  // ──────── knowledge_index_rebuild ────────

  async rebuildIndex(input: KnowledgeIndexRebuildInput): Promise<KnowledgeIndexRebuildResult> {
    const { spaceId, rootNodeToken, maxDepth } = input;

    // Get wiki tree
    const tree = await this.wikiTreeService.getTree(spaceId, {
      rootNodeToken,
      maxDepth: maxDepth ?? 3,
    });

    // Collect all document nodes
    const docNodes: Array<{ nodeToken: string; objToken: string; title: string }> = [];
    this.collectDocNodes(tree.tree, docNodes);

    // For each doc, export markdown and parse entries
    const entries: KnowledgeIndexEntry[] = [];
    let totalDocuments = 0;

    for (const node of docNodes) {
      try {
        const md = await this.markdownService.exportMarkdown({
          documentId: node.objToken,
        });
        totalDocuments++;

        const parsed = this.parseMarkdownEntries(md.markdown, node.objToken, node.title, spaceId);
        entries.push(...parsed);
      } catch {
        // Skip documents that can't be exported
      }
    }

    // Save index — merge with entries from other spaces
    this.indexStore.replaceBySpace(spaceId, entries);

    return {
      spaceId,
      totalDocuments,
      totalEntries: entries.length,
      indexPath: this.indexStore.getIndexPath(),
    };
  }

  // ──────── Private Helpers ────────

  private async enrichResults(
    indexResults: IndexSearchResult[],
    includeContent: boolean,
  ): Promise<KnowledgeSearchResultItem[]> {
    const items: KnowledgeSearchResultItem[] = [];

    for (const { entry } of indexResults) {
      let content: string | undefined;

      if (includeContent) {
        try {
          const md = await this.markdownService.exportMarkdown({
            documentId: entry.documentId,
          });
          // Try to extract only the relevant section
          content = this.extractSection(md.markdown, entry.sectionHeading);
        } catch {
          // Content fetch failed
        }
      }

      items.push({
        title: entry.title,
        documentId: entry.documentId,
        sectionHeading: entry.sectionHeading,
        summary: entry.summary,
        keywords: entry.keywords,
        category: entry.category,
        content,
      });
    }

    return items;
  }

  private extractSection(markdown: string, heading: string): string {
    const lines = markdown.split("\n");
    const headingPattern = new RegExp(`^##\\s+${this.escapeRegex(heading)}\\s*$`);
    let start = -1;

    for (let i = 0; i < lines.length; i++) {
      if (headingPattern.test(lines[i])) {
        start = i;
        continue;
      }
      if (start >= 0 && /^##\s+/.test(lines[i])) {
        return lines.slice(start, i).join("\n");
      }
    }

    if (start >= 0) {
      return lines.slice(start).join("\n");
    }

    return markdown;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private async findDocumentByTitle(spaceId: string, title: string): Promise<string | undefined> {
    const authType = this.authManager.getStatus().effectiveAuthType;
    try {
      const result = await this.searchService.search({
        searchKey: title,
        searchType: "both",
        spaceId,
        authType,
      });

      const allItems = [...(result.documents ?? []), ...(result.wikis ?? [])];
      const exact = allItems.find(
        (item) => item.title?.trim().toLowerCase() === title.trim().toLowerCase(),
      );
      return exact?.documentId;
    } catch {
      return undefined;
    }
  }

  private collectDocNodes(
    nodes: WikiTreeNode[],
    out: Array<{ nodeToken: string; objToken: string; title: string }>,
  ): void {
    for (const node of nodes) {
      if (node.objToken) {
        out.push({
          nodeToken: node.nodeToken,
          objToken: node.objToken,
          title: node.title,
        });
      }
      if (node.children.length > 0) {
        this.collectDocNodes(node.children, out);
      }
    }
  }

  private parseMarkdownEntries(
    markdown: string,
    documentId: string,
    documentTitle: string,
    spaceId?: string,
  ): KnowledgeIndexEntry[] {
    const entries: KnowledgeIndexEntry[] = [];
    const lines = markdown.split("\n");
    let currentHeading: string | undefined;
    let currentContent: string[] = [];

    const flush = () => {
      if (currentHeading) {
        const content = currentContent.join("\n");
        const keywords = this.extractKeywords(content);
        const summary = this.extractSummary(content);

        entries.push({
          id: `entry-${randomUUID().slice(0, 8)}`,
          title: currentHeading,
          keywords,
          category: documentTitle,
          spaceId,
          documentId,
          sectionHeading: currentHeading,
          summary,
          createdAt: this.extractDate(content) ?? new Date().toISOString().slice(0, 10),
        });
      }
    };

    for (const line of lines) {
      const h2Match = /^##\s+(.+)$/.exec(line);
      if (h2Match) {
        flush();
        currentHeading = h2Match[1].trim();
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }
    flush();

    return entries;
  }

  private extractKeywords(content: string): string[] {
    const match = /\*\*关键词\*\*\s*[:：]\s*(.+)/i.exec(content);
    if (match) {
      return match[1]
        .split(/[,，]/)
        .map((k) => k.trim())
        .filter(Boolean);
    }
    return [];
  }

  private extractSummary(content: string): string {
    // Try to get the first line of "解决方案" section
    const solutionMatch = /###\s*解决方案\s*\n+(.+)/i.exec(content);
    if (solutionMatch) {
      const line = solutionMatch[1].trim();
      return line.length > 100 ? line.slice(0, 100) + "..." : line;
    }

    // Fallback: first non-empty, non-metadata line
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("**") && !trimmed.startsWith("###")) {
        return trimmed.length > 100 ? trimmed.slice(0, 100) + "..." : trimmed;
      }
    }
    return "";
  }

  private extractDate(content: string): string | undefined {
    const match = /\*\*日期\*\*\s*[:：]\s*(\d{4}-\d{2}-\d{2})/.exec(content);
    return match?.[1];
  }
}
