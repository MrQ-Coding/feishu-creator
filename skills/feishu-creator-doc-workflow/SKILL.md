---
name: feishu-creator-doc-workflow
description: Safely create, inspect, update, replace, move, copy, and verify Feishu documents and wiki notes via feishu-creator MCP tools. Use when the user wants to operate on Feishu documents — not for installation (use feishu-setup) or drafting content (use feishu-doc-writer).
---

# Feishu Document Workflow

Use this skill when the task is a Feishu document operation: creating, reading, editing, reorganizing, or batch-managing documents and wiki nodes. For installation and setup, use `feishu-setup`. For drafting document content, use `feishu-doc-writer`.

## Route By Intent

| User intent | Start here |
|-------------|------------|
| Create a new document or wiki page | [Recipe: Create a document](#recipe-create-a-document) |
| Update or rewrite a section | [Recipe: Update a section](#recipe-update-a-section) |
| Import local markdown to Feishu | [Recipe: Markdown sync](#recipe-markdown-sync) |
| Reorganize wiki structure | [Recipe: Reorganize sections](#recipe-reorganize-sections) |
| Batch operations on multiple docs | [Recipe: Batch operations](#recipe-batch-operations) |
| Add diagrams or images | [references/operation-recipes.md](references/operation-recipes.md) |
| Tables | [references/operation-recipes.md](references/operation-recipes.md) |

## Core Principles

1. **Inspect before mutating.** Always `get_document_blocks` or `export_document_to_markdown` before structural edits.
2. **Use the highest-level primitive.** Prefer heading-based tools over block-index tools. Prefer `upsert_section` over `delete_by_heading` + `insert_before_heading`.
3. **Verify after changes.** Re-read the affected area and confirm the result. See [Verification](#verification).
4. **Fail safely.** When an edit fails, do not retry blindly. Diagnose first. See [Error Recovery](#error-recovery).

## Edit Primitives (preference order)

| Priority | Tool | When to use |
|----------|------|-------------|
| 1 | `upsert_section` | Replace existing or create new section by heading |
| 2 | `replace_section_blocks` | Replace section content, keep heading |
| 3 | `generate_section_blocks` | Create structured content (heading + items) |
| 4 | `generate_rich_text_blocks` | Create mixed rich-text blocks |
| 5 | `insert_before_heading` | Insert content before a specific heading |
| 6 | `import_markdown_to_document` | Bulk content from markdown |
| 7 | `batch_create_blocks` | Low-level block insertion (last resort) |

---

## Recipe: Create a document

**Scenario:** User wants a new Feishu doc or wiki page.

1. `create_document` — specify title and optional wiki space/parent node.
2. Write content using one of:
   - `import_markdown_to_document` — if source is markdown text.
   - `generate_section_blocks` — if building structured sections.
   - `upsert_section` (repeated) — if building section by section.
3. Verify: `get_document_blocks` to confirm structure.

## Recipe: Update a section

**Scenario:** User wants to modify part of an existing document.

1. `get_document_info` — resolve the document.
2. `export_document_to_markdown` or `get_document_blocks` — understand current structure.
3. `preview_edit_plan` — preview what will be matched and changed (optional but recommended for complex edits).
4. Execute the edit:
   - Single section: `replace_section_blocks` or `upsert_section`.
   - Insert new content before a heading: `insert_before_heading`.
   - Delete a section: `delete_by_heading`.
5. Verify: `get_document_blocks` on the affected area.

## Recipe: Markdown sync

**Scenario:** User has local markdown and wants it in Feishu.

1. Resolve or create the target document.
2. `import_markdown_to_document` — import the markdown content.
3. Verify: `export_document_to_markdown` to round-trip check.

**Caveats:**
- Markdown → Feishu is lossy for complex formatting (nested tables, HTML).
- Images in markdown must be local file paths or accessible URLs.
- If round-trip check shows issues, fall back to section-by-section `upsert_section`.

## Recipe: Reorganize sections

**Scenario:** User wants to move, copy, or reorder sections.

1. `get_document_blocks` — map current heading structure.
2. Execute:
   - `move_section` — move within same doc or across docs.
   - `copy_section` — duplicate to same or another doc.
3. Verify: `get_document_blocks` on both source and target.

**Cross-document moves:** When moving to another doc, verify both documents after the operation. The source section should be gone; the target should have it.

## Recipe: Batch operations

**Scenario:** User wants to operate on multiple documents.

1. Discover targets: `search_feishu_documents` or `get_feishu_wiki_tree`.
2. For each document, apply the appropriate single-doc recipe above.
3. Report results: list successes and failures separately.

**Guardrails for batch:**
- Confirm with user before deleting multiple documents.
- Process sequentially, not in parallel, to avoid rate limits.
- Stop and report on first unexpected error rather than continuing blindly.

---

## Verification

After any structural edit, verify with these criteria:

| Check | How | Failure action |
|-------|-----|----------------|
| Content landed correctly | `get_document_blocks` — find the new/updated blocks | Re-inspect heading match, retry with corrected heading text |
| No duplicates | Scan for repeated headings or blocks | `delete_by_heading` the duplicate |
| Correct hierarchy | Verify heading levels and parent-child nesting | Use `move_section` to fix placement |
| No stray blocks | Look for orphaned list items, images, or empty paragraphs | `delete_document_blocks` to clean up |

## Error Recovery

| Error | Likely cause | Recovery |
|-------|-------------|----------|
| Heading not found | Heading text doesn't match exactly (whitespace, numbering, Unicode) | `get_document_blocks` to find actual heading text, retry with exact match |
| Section replace produced empty content | Block payload was malformed | Inspect the block payload, fix formatting, retry |
| "block not found" on update | Block was deleted or moved by concurrent edit | Re-read document, locate the block's new position |
| Rate limited (429) | Too many rapid API calls | Wait and retry; for batch ops, add delays between documents |
| Auth expired mid-operation | Token TTL exceeded during long operation | Operation auto-retries with refreshed token; if persistent, re-check credentials |
| Content lost after edit | Wrong section matched (ambiguous heading) | Use heading path (e.g., `一级标题/二级标题`) for precise matching; restore from document history in Feishu UI |
| Import markdown partial | Unsupported markdown syntax | Fall back to `upsert_section` for problematic sections |

## Guardrails

- Prefer heading-based tools over block-index tools.
- For deletions, prefer `delete_by_heading` over `delete_document_blocks`.
- Do not dump raw MCP tool output — add a short explanatory sentence.
- When heading text is ambiguous, use heading path (parent/child) for precise matching.
- For large documents (100+ blocks), prefer section-level operations over full-document rewrites.
- Always confirm with the user before destructive operations (delete document, batch delete).

## References

- [references/operation-recipes.md](references/operation-recipes.md) — edit primitive details, diagram and table tools.
