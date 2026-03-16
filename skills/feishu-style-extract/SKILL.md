---
name: feishu-style-extract
description: Analyze representative Feishu docs or wiki notes, extract a reusable writing-style profile, and optionally save the profile back into Feishu. Use when the user asks to analyze their writing style, imitate an existing author voice, keep document tone consistent, or build a style guide from Feishu content.
---

# Feishu Style Extract

Use this skill when the main task is inferring a person's writing style from existing Feishu documents and turning that into a reusable profile for future drafting.

## When To Use

- User says `分析一下我的写作风格`, `总结我的文风`, `帮我生成风格画像`
- User wants AI to imitate an author voice based on Feishu docs
- User wants to unify tone across a document set before drafting new content
- User wants to preserve an existing author's style during rewrites or expansion

## Required MCP Tools

- `get_document_info` — Normalize document URLs, IDs, and basic metadata
- `export_document_to_markdown` — Read the document's written content for style analysis
- `get_document_blocks` — Inspect headings, list density, and formatting habits when Markdown alone is insufficient
- `list_feishu_wiki_spaces` — Discover the target wiki space when the user only gives a broad scope
- `get_feishu_wiki_tree` — Enumerate candidate docs under one space or subtree
- `search_feishu_documents` — Find likely representative pages by topic or title when the scope is fuzzy
- `find_style_profiles` — Inspect already-saved profile candidates before creating duplicates
- `resolve_style_profile` — Reuse an existing approved profile when the task is really retrieval, not fresh extraction
- `create_document` — Save a new style guide doc when the user wants persistence
- `import_markdown_to_document` — Write the generated profile into a new Feishu page
- `upsert_section` — Prefer this when updating an existing style guide page in place

## Ownership Rules

- In local or single-user `user` mode, the approved profile can be treated as belonging to the current Feishu user.
- In shared HTTP deployments, do not infer profile ownership from `MCP_HTTP_AUTH_TOKEN`.
- In shared HTTP deployments, require a stable owner key from the outer app layer, such as your own `app_user_id`.
- When saving profiles for later reuse, prefer storing `owner_id`, `profile_kind`, `sample_docs`, and `updated_at` in a machine-readable header at the top of the profile document.
- Default to saving approved profiles back into the user's own Feishu docs rather than any service-side profile store.

## Workflow

### Step 1: Determine the analysis scope

Before collecting samples, check whether the user is actually asking for a fresh extraction or wants to reuse an existing approved profile. If reuse is likely, prefer `resolve_style_profile` first.

Resolve one of these cases first:

- **Case A — Specific documents**: The user provides `1-N` document URLs or IDs. Use them directly.
- **Case B — One wiki space or subtree**: The user points to a wiki space, folder, or knowledge area. Discover candidate docs under that subtree.
- **Case C — Fuzzy request**: The user only says "分析我的文风". In that case, prefer asking for `3-5` representative documents or one clear wiki space unless the target set is already obvious from local context.

If the user wants "某个人的文风", verify authorship when mixed ownership is likely.

### Step 2: Gather representative samples

For each candidate page:

1. Normalize the page with `get_document_info`.
2. Read the prose content with `export_document_to_markdown`.
3. Fall back to `get_document_blocks` when you need to inspect heading hierarchy, list density, or formatting patterns more directly.

Sampling rules:

- Prefer `5-10` documents when available.
- Favor original writing over copied source material.
- Favor substantial prose over thin status notes.
- Favor topic diversity so the result reflects style, not one narrow subject area.
- Down-rank documents dominated by code blocks, tables, screenshots, templates, or meeting transcripts.

### Step 3: Filter and rate the samples

Before drawing conclusions, rate each sample informally:

- **Strong**: clearly original, substantial, mostly prose, representative tone
- **Medium**: partially representative but narrow in topic or structure
- **Weak**: too short, too templated, mostly copied, or not clearly authored by the target writer

Keep the final profile anchored mainly on strong and medium samples.

If fewer than `3` credible samples remain:

- say that confidence is limited
- avoid overconfident claims
- ask for more original writing before treating the profile as stable

### Step 4: Analyze style dimensions

Analyze the sample set across these dimensions:

- **Vocabulary**: formality, jargon density, favorite words, connector habits, Chinese-English mixing
- **Sentence structure**: average sentence length, clause complexity, paragraph density, list usage, rhetorical questions, cadence
- **Tone and voice**: first person vs. impersonal, confidence level, teaching vs. conversational stance, emotional temperature, humor
- **Structural habits**: opening pattern, closing pattern, heading style, example density, formatting preferences, callout usage

Separate stable style traits from topic effects. A React-heavy doc may create jargon that does not reflect the author's general writing style.

### Step 5: Generate the profile draft

Produce a profile with these parts:

- one-sentence overall characterization
- sample scope and why those samples were chosen
- vocabulary, sentence, tone, and structure findings
- a `风格指纹` section with concrete reusable drafting rules
- one short representative excerpt with annotation
- a short `使用方式` section when the user wants future writing to follow this voice

Use [references/style-profile-template.md](references/style-profile-template.md) as the default shape.

### Step 6: Present confidence and ask for corrections

Show the draft before saving. Invite corrections such as:

- `我没有那么正式`
- `这个词只是那篇文章里常见，不算我的习惯`
- `我希望以后更简洁一点`

Distinguish:

- **current style**: what the samples show now
- **target style**: what the user wants future writing to become

If the user is really asking for a future target voice, record both instead of rewriting the evidence.

### Step 7: Save back to Feishu when confirmed

- New style guide page: use `create_document` plus `import_markdown_to_document`
- Existing style guide page: prefer `upsert_section` or another heading-based update path so the page stays canonical

When saving, prefer a title such as `✍️ 写作风格画像 - 深度讲解型`, `✍️ 写作风格画像 - 工作记录型`, or `✍️ 团队文风基线`.
When the deployment is multi-user, include ownership metadata so later retrieval does not mix profiles across users.
Treat save-back as the default happy path, not an optional afterthought, unless the user explicitly says not to persist the profile.

### Step 8: Reuse the profile in later drafting

When the user later asks to write in this style:

1. Retrieve or reuse the approved style profile. Prefer `resolve_style_profile` over ad-hoc search/parsing when available.
2. Prefer retrieving it from the user's own Feishu doc store, not from any service-side cache.
3. Apply only the stable `风格指纹` rules, not every topic-specific word choice.
4. If the task is actual drafting or rewriting, combine this skill with `$feishu-doc-writer`.
5. After drafting, self-check whether the output matches the profile's tone, structure, and rhythm.

## Default Tool Route

- Resolve a page: `get_document_info`
- Discover spaces: `list_feishu_wiki_spaces`
- Discover candidate pages: `get_feishu_wiki_tree`, `search_feishu_documents`
- Read content: `export_document_to_markdown`
- Inspect structure when needed: `get_document_blocks`
- Find or resolve an existing profile first: `find_style_profiles`, `resolve_style_profile`
- Save a new profile: `create_document`, `import_markdown_to_document`
- Update an existing profile doc: `upsert_section`

## Guardrails

- Prefer descriptive judgments over prescriptive judgments. Describe how the author writes; do not grade the style unless asked.
- Do not overfit to one strong sample. Call out when a trait appears in only one document.
- Distinguish observed facts from inference. `常用编号标题` is an observation; `重视教学感` is an inference.
- Avoid fake precision. Use `倾向于`, `明显偏好`, `经常出现`, or `在多数样本中` unless you actually counted.
- Keep quoted examples short and representative.
- If documents have mixed authorship, verify which pages are truly written by the target author.
- Preserve the difference between `现有文风` and `希望形成的文风`.
- Do not save the profile back to Feishu until the user has seen and accepted the draft.
- In shared HTTP mode, do not attach the profile to "当前用户" unless the outer system has already resolved a stable owner identity.
- If the user declines persistence, still format the result as a profile doc so it can be saved into Feishu later without re-analysis.

## Error Handling

| Situation | Action |
|-----------|--------|
| Document not found | Skip it, note the miss, and continue with remaining samples |
| Permission denied | Tell the user the page cannot be read with current auth and ask for another sample if needed |
| Exported Markdown is nearly empty | Fall back to `get_document_blocks`; if still empty, treat the doc as weak evidence |
| Search returns many candidates | Sample only the most representative `5-10` pages and explain the sampling basis |
| Too few original docs | Tell the user confidence is low and ask for more original writing |
| Mixed authorship | Ask the user to confirm which documents belong to the target author before finalizing |
| Save-back fails | Present the approved profile in chat and say the Feishu write-back did not complete |

## References

- Read [references/style-profile-template.md](references/style-profile-template.md) for the default output shape, review checklist, and save-back suggestions.
