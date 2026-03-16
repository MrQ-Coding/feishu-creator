---
name: feishu-creator-doc-workflow
description: Install, initialize, configure, and operate the feishu-creator MCP end-to-end. Use when the user asks to install `feishu-creator`, wire it into an MCP client, verify auth and startup, or safely create, inspect, update, replace, move, copy, and verify Feishu documents and wiki notes.
---

# Feishu Creator Workflow

Use this skill when the task touches the `feishu-creator` lifecycle end-to-end: local bootstrap, MCP client wiring, install verification, or safe Feishu document operations.

## Route By Intent

- Setup, install, bootstrap, or client wiring: start with [references/setup-recipes.md](references/setup-recipes.md).
- Document creation, inspection, update, replace, move, copy, or verification: start with [references/operation-recipes.md](references/operation-recipes.md).
- User-facing setup reporting: use [references/install-report-template.md](references/install-report-template.md).

## Default Workflow

1. Resolve the repo root and prefer the current workspace when it already contains `package.json`, `.env.example`, and `src/`.
2. Finish install and build work before blocking on missing Feishu credentials.
3. Prefer `MCP_MODE=auto` with `--stdio` unless the user explicitly wants HTTP.
4. Use the highest-level MCP edit primitive that matches the task instead of manually composing low-level block operations.
5. Re-read the affected document area after structural edits and confirm the result.

## Guardrails

- Keep absolute file paths when reporting generated or updated files.
- Treat `Graphviz` and `PlantUML` readiness as part of install health if the task includes diagram support.
- Prefer heading-based tools such as `replace_section_blocks`, `upsert_section`, `copy_section`, and `move_section` over guessed block indices.
- For deletions, prefer semantic or service-level flows before raw block-index deletion.
- Do not dump raw MCP tool output back to the user without a short explanatory sentence.
