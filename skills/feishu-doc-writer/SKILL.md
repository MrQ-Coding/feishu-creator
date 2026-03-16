---
name: feishu-doc-writer
description: Write, rewrite, polish, and restructure Feishu technical documents and wiki notes in Chinese with clear numbered sections, concise evidence-driven snippets, and source-backed call-chain explanations. Use when Codex needs to turn rough notes into readable documentation, improve wording and structure, or draft a new technical note from code analysis.
---

# Feishu Document Writer

Use this skill when the main task is drafting or rewriting the document itself. Optimize for clear Chinese teaching-style explanations, numbered structure, and compact source-backed evidence.

## Workflow

1. Pick the mode first.
- New draft: build a clean outline and write directly.
- Rewrite: keep the useful intent, but rewrite weak sections instead of commenting on the draft.

2. Build the section hierarchy before details.
- Use explicit numbered headings such as `一、...`, `二、...`.
- For longer technical notes, default to `概览 -> 概念介绍 -> 源码入口 -> 源码解析 -> 关键子流程 -> 总结`.
- Insert bridge sections at the right heading level instead of overloading one section.

3. Write the main path first.
- Explain the primary call chain top-down before branches.
- Start major sections with a short overview sentence when useful.
- Avoid meta-writing; give direct conclusions, judgments, and explanations.

4. Keep evidence compact and labeled.
- Put the source path before each snippet or in the first comment line of the code block.
- Keep only the lines that prove the current point.
- After each snippet, add one short sentence explaining what it proves and the next hop.

5. Keep formatting intentional.
- Use inline code for stable identifiers and source paths, not for ordinary Chinese words.
- Keep emphasis sparse and high-value.
- For validation notes, separate observation, evidence, inference, and recommendation.
- Mention search/index delay when a fresh search miss is not strong proof by itself.

6. Finish with a consistency check.
- Re-check section order, terminology consistency, and whether each section still supports the main conclusion.
- End larger notes with a short recap.

## Writing Checklist

1. Use a clear numbered structure such as `一、...`, `二、...`.
2. Lead with the main path, then expand into branches and subflows.
3. Keep code evidence small and explanatory, not exhaustive.
4. Separate measured facts from inference.
5. End larger notes with a recap that closes the argument.

## References

- Read [references/feishu-note-template.md](references/feishu-note-template.md) for a reusable section skeleton and snippet style.
