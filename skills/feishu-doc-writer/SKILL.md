---
name: feishu-doc-writer
description: Write, rewrite, polish, and restructure Feishu documents and wiki notes in Chinese. Supports multiple document types including technical analysis, design proposals, meeting notes, and general documentation. Use when turning rough notes into readable documents, improving wording and structure, or drafting new documents.
---

# Feishu Document Writer

Use this skill when the main task is drafting or rewriting document content. This skill focuses on the writing itself — for Feishu API operations, use `feishu-doc-workflow`.

## Workflow

### 1. Determine document type

Before writing, identify which type best fits the task:

| Type | Trigger phrases | Template |
|------|----------------|----------|
| **技术分析** | 源码分析、代码解读、调用链、实现原理 | [references/template-technical.md](references/template-technical.md) |
| **方案设计** | 技术方案、设计文档、架构设计、RFC | [references/template-design.md](references/template-design.md) |
| **会议纪要** | 会议记录、讨论纪要、对齐结论 | [references/template-meeting.md](references/template-meeting.md) |
| **通用文档** | 说明文档、操作手册、知识沉淀 | Use numbered structure, no fixed skeleton |

If unclear, ask the user. Default to **通用文档** when the type doesn't fit the others.

### 2. Pick the mode

- **New draft**: Build a clean outline first, then fill content.
- **Rewrite**: Keep the useful intent, rewrite weak sections directly. Do not comment on the draft — just fix it.

### 3. Resolve style guidance (when needed)

Only when the user asks for style consistency ("按我的风格写", "保持原来的文风"):

1. Try `resolve_style_profile` first.
2. If found, apply its `风格指纹` rules as drafting constraints.
3. If not found and the user wants one, hand off to `feishu-style-extract`.
4. If not asked for style, skip this step entirely.

### 4. Build the section hierarchy

- Use explicit numbered headings: `一、...`, `二、...`.
- Choose the skeleton from the matched template.
- Insert bridge sections at the right heading level rather than overloading one section.
- For short documents (< 5 sections), a flat structure is fine.

### 5. Write the content

Core writing rules (apply to all document types):

1. **Lead with conclusions.** State the key point first, then explain.
2. **One idea per paragraph.** Keep paragraphs focused and scannable.
3. **Evidence is compact.** Code snippets, data, quotes — only the lines that prove the current point. Label the source before each snippet.
4. **Formatting is intentional.** Inline code for identifiers and paths, not for ordinary Chinese words. Keep emphasis sparse.
5. **Transitions are explicit.** End sections with a bridge sentence when the next section builds on the current one.
6. **Avoid meta-writing.** No "本节将介绍..." — just explain directly.

### 6. Consistency check

Before delivering:

- Section order follows a logical progression.
- Terminology is consistent throughout.
- Each section supports the document's main argument or purpose.
- Longer documents end with a recap.

## Writing Checklist

1. Document type identified, correct template applied.
2. Clear numbered structure (`一、...`, `二、...`).
3. Conclusions first, details second.
4. Code/data evidence is small and labeled.
5. Facts separated from inference.
6. Longer documents have a recap closing.
7. Style profile applied if one is in play.

## References

- [references/template-technical.md](references/template-technical.md) — Technical analysis template.
- [references/template-design.md](references/template-design.md) — Design proposal template.
- [references/template-meeting.md](references/template-meeting.md) — Meeting notes template.
