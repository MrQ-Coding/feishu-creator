---
name: feishu-style-extract
description: Analyze representative Feishu docs or wiki notes, extract a reusable writing-style profile, and optionally save the profile back into Feishu. Use when the user asks to analyze their writing style, imitate an existing author voice, keep document tone consistent, or build a style guide from Feishu content.
---

# Feishu Style Extract

Use this skill when the main task is inferring a person's writing style from existing Feishu documents and turning it into a reusable profile. For applying an already-saved profile during drafting, use `feishu-doc-writer` instead (it calls `resolve_style_profile` automatically).

## When To Use

- User says "分析一下我的写作风格", "总结我的文风", "帮我生成风格画像"
- User wants to imitate an author voice based on Feishu docs
- User wants to unify tone across a document set before drafting
- User wants to preserve an existing author's style during rewrites

## Workflow

### Fast Path (try first)

1. Call `resolve_style_profile`.
2. If a profile is found and the user isn't asking for a refresh → return it. Done.
3. If found but the user wants to update it → continue to Full Extraction, use the existing profile as a baseline.

### Full Extraction

#### Step 1: Determine scope

Resolve one of:

- **Specific documents**: User provides 1-N document URLs or IDs. Use them directly.
- **Wiki space or subtree**: Discover candidates via `get_feishu_wiki_tree`.
- **Fuzzy request** ("分析我的文风"): Ask for 3-5 representative documents unless the target set is obvious from context.

#### Step 2: Gather and rate samples

For each candidate:

1. `get_document_info` → normalize the page.
2. `export_document_to_markdown` → read content.
3. Fall back to `get_document_blocks` when markdown is insufficient.

Rate each sample:

- **Strong**: original, substantial prose, representative tone.
- **Medium**: partially representative, narrow topic or structure.
- **Weak**: too short, templated, copied, or unclear authorship.

If fewer than 3 credible samples remain, state low confidence and ask for more.

Sampling limits:

- Prefer 5-10 documents.
- Favor original writing over copied material.
- Favor topic diversity over volume.
- Down-rank documents dominated by code, tables, or screenshots.

#### Step 3: Analyze style dimensions

Analyze across four dimensions:

| Dimension | What to look for |
|-----------|-----------------|
| **词汇** | 正式度、术语密度、偏好词、中英混用习惯 |
| **句式** | 平均句长、从句复杂度、段落密度、列表使用、节奏感 |
| **语气** | 人称、自信度、教学感 vs 对话感、情感色温 |
| **结构** | 开头模式、标题风格、示例密度、格式偏好 |

Separate stable style traits from topic-specific effects.

#### Step 4: Generate profile

Use [references/style-profile-template.md](references/style-profile-template.md) as the output shape. Key sections:

- One-sentence overall characterization
- Sample scope and selection rationale
- Findings per dimension
- `风格指纹`: 5+ concrete, reusable drafting rules
- One representative excerpt with annotation
- `使用方式` section

#### Step 5: Confirm and save

1. **Present the draft** before saving. Invite corrections.
2. Distinguish current style (what samples show) from target style (what user wants).
3. **Save to Feishu** (default unless user declines):
   - New profile: `create_document` + `import_markdown_to_document`
   - Update existing: `upsert_section`
   - Title convention: `✍️ 写作风格画像 - {类型}`

## Error Handling

| Situation | Action |
|-----------|--------|
| Document not found | Skip, note the miss, continue |
| Permission denied | Note in report, ask for another sample |
| Empty markdown export | Fall back to `get_document_blocks` |
| Too many candidates | Sample top 5-10, explain basis |
| Too few credible samples | State low confidence, ask for more |
| Mixed authorship | Confirm ownership before finalizing |
| Save-back fails | Present profile in chat, note write-back incomplete |

## Guardrails

- Describe how the author writes; do not grade the style unless asked.
- Do not overfit to one sample. Call out single-document traits.
- Distinguish observations from inferences (`常用编号标题` is observation; `重视教学感` is inference).
- Avoid fake precision — use `倾向于`, `明显偏好`, `经常出现`.
- Do not save until the user has seen and accepted the draft.
- In shared HTTP mode, require a stable owner identity before attaching profile ownership.

## References

- [references/style-profile-template.md](references/style-profile-template.md) — default output shape and review checklist.
