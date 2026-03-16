import type { RuntimeIdentity } from "../../appContext.js";
import type { FeishuAuthManager } from "../../feishu/authManager.js";
import type { ExportMarkdownInput, MarkdownDocumentService } from "../markdown/service.js";
import type { SearchService, StandardSearchItem } from "../search/index.js";

export interface StyleProfileMetadata {
  profileVersion?: number;
  ownerId?: string;
  ownerSource?: string;
  profileKind?: string;
  profileStatus?: string;
  updatedAt?: string;
  confidence?: string;
  sampleDocs: string[];
}

export interface StyleProfileSections {
  overallSummary?: string;
  fingerprintRules: string[];
  usageNotes: string[];
}

export interface StyleProfileCandidate {
  title: string;
  documentId: string;
  sourceType: "document" | "wiki";
  url?: string;
  spaceId?: string;
  metadata: StyleProfileMetadata;
  sections: StyleProfileSections;
  match: {
    score: number;
    ownerMatched: boolean;
    profileKindMatched: boolean;
    approved: boolean;
    reasons: string[];
  };
}

export interface FindStyleProfilesInput {
  ownerId?: string;
  profileKind?: string;
  spaceId?: string;
  limit?: number;
  searchKey?: string;
}

export interface ResolveStyleProfileInput {
  ownerId?: string;
  profileKind?: string;
  spaceId?: string;
  documentId?: string;
  allowFallback?: boolean;
}

interface ParsedStyleProfile {
  metadata: StyleProfileMetadata;
  sections: StyleProfileSections;
}

export class StyleProfileService {
  private static readonly DEFAULT_SEARCH_KEY = "写作风格画像";
  private static readonly DEFAULT_LIMIT = 5;
  private static readonly SEARCH_CANDIDATE_LIMIT = 20;

  constructor(
    private readonly searchService: SearchService,
    private readonly markdownDocumentService: MarkdownDocumentService,
    private readonly authManager: FeishuAuthManager,
    private readonly runtimeIdentity: RuntimeIdentity,
  ) {}

  async findProfiles(input: FindStyleProfilesInput): Promise<{
    searchedOwnerId?: string;
    searchedProfileKind?: string;
    totalCandidates: number;
    candidates: StyleProfileCandidate[];
  }> {
    const ownerId = this.resolveOwnerId(input.ownerId);
    const profileKind = this.normalizeOptional(input.profileKind);
    const limit = this.clampLimit(input.limit);
    const searchKey =
      this.normalizeOptional(input.searchKey) ??
      StyleProfileService.DEFAULT_SEARCH_KEY;

    const searchResult = await this.searchService.search({
      searchKey,
      searchType: "both",
      spaceId: this.normalizeOptional(input.spaceId),
      authType: this.authManager.getStatus().effectiveAuthType,
    });

    const combinedCandidates = this.mergeSearchItems(searchResult.documents, searchResult.wikis);
    const resolvedCandidates: StyleProfileCandidate[] = [];

    for (const item of combinedCandidates.slice(0, StyleProfileService.SEARCH_CANDIDATE_LIMIT)) {
      const candidate = await this.buildCandidate(item, ownerId, profileKind);
      if (!candidate) continue;
      resolvedCandidates.push(candidate);
    }

    const filteredCandidates = resolvedCandidates
      .filter((candidate) => this.includeCandidate(candidate, ownerId, profileKind))
      .sort((left, right) => right.match.score - left.match.score)
      .slice(0, limit);

    return {
      searchedOwnerId: ownerId,
      searchedProfileKind: profileKind,
      totalCandidates: filteredCandidates.length,
      candidates: filteredCandidates,
    };
  }

  async resolveProfile(input: ResolveStyleProfileInput): Promise<{
    matched: boolean;
    searchedOwnerId?: string;
    searchedProfileKind?: string;
    matchReason: string;
    profile?: StyleProfileCandidate;
  }> {
    const ownerId = this.resolveOwnerId(input.ownerId);
    const profileKind = this.normalizeOptional(input.profileKind);
    const explicitDocumentId = this.normalizeOptional(input.documentId);
    const allowFallback = input.allowFallback ?? true;

    if (explicitDocumentId) {
      const explicitCandidate = await this.buildCandidate(
        {
          sourceType: "document",
          documentId: explicitDocumentId,
          title: explicitDocumentId,
          raw: {},
        },
        ownerId,
        profileKind,
      );
      if (!explicitCandidate) {
        return {
          matched: false,
          searchedOwnerId: ownerId,
          searchedProfileKind: profileKind,
          matchReason: "Explicit documentId was provided but the document could not be parsed as a style profile.",
        };
      }
      return {
        matched: true,
        searchedOwnerId: ownerId,
        searchedProfileKind: profileKind,
        matchReason: "Resolved from explicit documentId.",
        profile: explicitCandidate,
      };
    }

    const result = await this.findProfiles({
      ownerId,
      profileKind,
      spaceId: input.spaceId,
      limit: StyleProfileService.DEFAULT_LIMIT,
    });

    if (result.candidates.length === 0) {
      return {
        matched: false,
        searchedOwnerId: ownerId,
        searchedProfileKind: profileKind,
        matchReason: "No candidate style profile documents were found.",
      };
    }

    const strictCandidate = result.candidates.find((candidate) => {
      if (ownerId && !candidate.match.ownerMatched) return false;
      if (profileKind && !candidate.match.profileKindMatched) return false;
      return candidate.match.approved;
    });
    if (strictCandidate) {
      return {
        matched: true,
        searchedOwnerId: ownerId,
        searchedProfileKind: profileKind,
        matchReason: strictCandidate.match.reasons.join("; "),
        profile: strictCandidate,
      };
    }

    if (!allowFallback) {
      return {
        matched: false,
        searchedOwnerId: ownerId,
        searchedProfileKind: profileKind,
        matchReason: "Candidates exist, but none satisfied the requested owner/profile filters.",
      };
    }

    return {
      matched: true,
      searchedOwnerId: ownerId,
      searchedProfileKind: profileKind,
      matchReason: `Fallback matched the highest-scoring candidate: ${result.candidates[0].match.reasons.join("; ")}`,
      profile: result.candidates[0],
    };
  }

  private async buildCandidate(
    item: StandardSearchItem,
    ownerId?: string,
    profileKind?: string,
  ): Promise<StyleProfileCandidate | undefined> {
    const documentId = this.normalizeOptional(item.documentId ?? item.objToken);
    if (!documentId) {
      return undefined;
    }

    let exported;
    try {
      exported = await this.markdownDocumentService.exportMarkdown(
        this.buildExportInput(documentId),
      );
    } catch {
      return undefined;
    }

    const parsed = this.parseProfileMarkdown(exported.markdown);
    const title =
      this.normalizeOptional(item.title) ??
      this.extractTitle(exported.markdown) ??
      documentId;
    if (!this.looksLikeProfile(title, parsed)) {
      return undefined;
    }

    const normalizedMetadata = this.normalizeMetadata(parsed.metadata, title);
    const match = this.computeMatch(normalizedMetadata, title, ownerId, profileKind);

    return {
      title,
      documentId,
      sourceType: item.sourceType,
      url: this.normalizeOptional(item.url),
      spaceId: this.normalizeOptional(item.spaceId),
      metadata: normalizedMetadata,
      sections: parsed.sections,
      match,
    };
  }

  private buildExportInput(documentId: string): ExportMarkdownInput {
    return { documentId };
  }

  private mergeSearchItems(
    documents?: StandardSearchItem[],
    wikis?: StandardSearchItem[],
  ): StandardSearchItem[] {
    const merged = new Map<string, StandardSearchItem>();
    for (const item of [...(wikis ?? []), ...(documents ?? [])]) {
      const documentId = this.normalizeOptional(item.documentId ?? item.objToken);
      if (!documentId || merged.has(documentId)) continue;
      merged.set(documentId, item);
    }
    return Array.from(merged.values());
  }

  private includeCandidate(
    candidate: StyleProfileCandidate,
    ownerId?: string,
    profileKind?: string,
  ): boolean {
    if (ownerId && candidate.metadata.ownerId && candidate.metadata.ownerId !== ownerId) {
      return false;
    }
    if (
      profileKind &&
      candidate.metadata.profileKind &&
      candidate.metadata.profileKind !== profileKind
    ) {
      return false;
    }
    return true;
  }

  private resolveOwnerId(inputOwnerId?: string): string | undefined {
    const explicitOwnerId = this.normalizeOptional(inputOwnerId);
    if (explicitOwnerId) return explicitOwnerId;

    const runtimeOwnerId = this.normalizeOptional(this.runtimeIdentity.appUserId);
    if (runtimeOwnerId) return runtimeOwnerId;

    if (this.runtimeIdentity.scope === "global") {
      return "current-user";
    }
    return undefined;
  }

  private clampLimit(limit?: number): number {
    if (!Number.isInteger(limit) || !limit || limit < 1) {
      return StyleProfileService.DEFAULT_LIMIT;
    }
    return Math.min(limit, 20);
  }

  private normalizeOptional(value: string | undefined | null): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  }

  private parseProfileMarkdown(markdown: string): ParsedStyleProfile {
    const normalizedMarkdown = this.normalizeMarkdown(markdown);
    const metadataBlock = this.extractMetadataBlock(normalizedMarkdown);
    const metadata = this.parseMetadata(metadataBlock);

    return {
      metadata,
      sections: {
        overallSummary: this.extractSectionFirstParagraph(
          normalizedMarkdown,
          "一句话概括",
        ),
        fingerprintRules: this.extractSectionList(normalizedMarkdown, "风格指纹"),
        usageNotes: this.extractSectionList(normalizedMarkdown, "使用方式"),
      },
    };
  }

  private normalizeMarkdown(markdown: string): string {
    return markdown
      .replace(/\\_/g, "_")
      .replace(/\\\*/g, "*")
      .replace(/\r\n/g, "\n");
  }

  private extractMetadataBlock(markdown: string): string | undefined {
    const standardFrontmatterMatch = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
    if (standardFrontmatterMatch?.[1]) {
      return standardFrontmatterMatch[1];
    }

    const collapsedFrontmatterMatch = markdown.match(/^---\s*([\s\S]*?)\s*---/);
    return collapsedFrontmatterMatch?.[1];
  }

  private parseMetadata(block?: string): StyleProfileMetadata {
    if (!block) {
      return { sampleDocs: [] };
    }

    const scalar = (key: string): string | undefined => {
      const inlineMatch = block.match(new RegExp(`${key}:\\s*([^\\n]+?)(?=\\s+[a-z][a-z0-9_]*:|$)`, "i"));
      if (inlineMatch?.[1]) {
        return this.cleanMetadataValue(inlineMatch[1]);
      }
      const lineMatch = block.match(new RegExp(`(?:^|\\n)${key}:\\s*([^\\n]+)`, "i"));
      if (lineMatch?.[1]) {
        return this.cleanMetadataValue(lineMatch[1]);
      }
      return undefined;
    };

    const sampleDocs = Array.from(
      new Set(
        [...block.matchAll(/(?:^|\n)-\s*([A-Za-z0-9]{10,})/g)]
          .map((match) => match[1]?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    );

    const profileVersionRaw = scalar("profile_version");
    const profileVersion =
      profileVersionRaw && Number.isFinite(Number(profileVersionRaw))
        ? Number(profileVersionRaw)
        : undefined;

    return {
      profileVersion,
      ownerId: scalar("owner_id"),
      ownerSource: scalar("owner_source"),
      profileKind: scalar("profile_kind"),
      profileStatus: scalar("profile_status"),
      updatedAt: scalar("updated_at"),
      confidence: scalar("confidence"),
      sampleDocs,
    };
  }

  private cleanMetadataValue(value: string): string {
    return value
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\s+$/g, "");
  }

  private extractSectionFirstParagraph(markdown: string, heading: string): string | undefined {
    const section = this.extractSection(markdown, heading);
    if (!section) return undefined;
    const paragraph = section
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("-") && !line.startsWith("1."));
    return paragraph || undefined;
  }

  private extractSectionList(markdown: string, heading: string): string[] {
    const section = this.extractSection(markdown, heading);
    if (!section) return [];
    return section
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^(\d+\.\s+|- )/.test(line))
      .map((line) => line.replace(/^(\d+\.\s+|- )/, "").trim())
      .filter((line) => line.length > 0);
  }

  private extractSection(markdown: string, heading: string): string | undefined {
    const normalizedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = markdown.match(
      new RegExp(`^##\\s+${normalizedHeading}\\s*\\n([\\s\\S]*?)(?=^##\\s+|^#\\s+|\\Z)`, "m"),
    );
    return match?.[1]?.trim() || undefined;
  }

  private extractTitle(markdown: string): string | undefined {
    const match = markdown.match(/^#\s+(.+)$/m);
    return this.normalizeOptional(match?.[1]);
  }

  private looksLikeProfile(title: string, parsed: ParsedStyleProfile): boolean {
    return (
      title.includes("写作风格画像") ||
      parsed.sections.fingerprintRules.length > 0 ||
      Boolean(parsed.metadata.profileKind)
    );
  }

  private normalizeMetadata(
    metadata: StyleProfileMetadata,
    title: string,
  ): StyleProfileMetadata {
    const inferredKind = this.inferProfileKindFromTitle(title);
    return {
      ...metadata,
      ownerId:
        metadata.ownerId ??
        (this.runtimeIdentity.scope === "global" ? "current-user" : undefined),
      profileKind: metadata.profileKind ?? inferredKind,
      sampleDocs: metadata.sampleDocs ?? [],
    };
  }

  private inferProfileKindFromTitle(title: string): string | undefined {
    if (title.includes("深度讲解")) return "deep-explainer";
    if (title.includes("工作记录")) return "work-log";
    return undefined;
  }

  private computeMatch(
    metadata: StyleProfileMetadata,
    title: string,
    ownerId?: string,
    profileKind?: string,
  ): StyleProfileCandidate["match"] {
    let score = 0;
    const reasons: string[] = [];

    const approved =
      metadata.profileStatus === undefined ||
      metadata.profileStatus === "approved";
    if (approved) {
      score += 20;
      reasons.push(
        metadata.profileStatus === "approved"
          ? "profile_status=approved"
          : "profile_status missing, treated as approved fallback",
      );
    }

    const ownerMatched = Boolean(ownerId && metadata.ownerId === ownerId);
    if (ownerMatched) {
      score += 100;
      reasons.push(`owner matched: ${ownerId}`);
    } else if (ownerId && !metadata.ownerId) {
      reasons.push("owner requested but candidate has no owner_id");
    }

    const effectiveProfileKind = metadata.profileKind ?? this.inferProfileKindFromTitle(title);
    const profileKindMatched = Boolean(profileKind && effectiveProfileKind === profileKind);
    if (profileKindMatched) {
      score += 80;
      reasons.push(`profile kind matched: ${profileKind}`);
    } else if (profileKind && !effectiveProfileKind) {
      reasons.push("profile kind requested but candidate has no profile_kind");
    }

    if (metadata.updatedAt) {
      score += 10;
      reasons.push(`has updated_at=${metadata.updatedAt}`);
    }
    if (metadata.confidence) {
      score += 5;
      reasons.push(`has confidence=${metadata.confidence}`);
    }
    if (metadata.sampleDocs.length > 0) {
      score += 5;
      reasons.push(`has ${metadata.sampleDocs.length} sample docs`);
    }

    return {
      score,
      ownerMatched,
      profileKindMatched,
      approved,
      reasons,
    };
  }
}
