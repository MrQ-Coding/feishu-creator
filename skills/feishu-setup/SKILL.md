---
name: feishu-setup
description: Install, build, configure, and health-check feishu-creator. Use when the user asks to install feishu-creator, wire it into an MCP client (Claude Code, Cursor, Codex, etc.), set up .env credentials, verify auth, or troubleshoot startup failures.
---

# Feishu Setup

Use this skill when the task is about getting feishu-creator running — install, build, env config, client wiring, or startup verification. Once the server is healthy, hand off to `feishu-doc-workflow` for document operations.

## Route By Intent

- Fresh install or rebuild: follow [references/setup-recipes.md](references/setup-recipes.md).
- Shared HTTP deployment or multi-user OAuth: follow [references/http-multi-user-recipes.md](references/http-multi-user-recipes.md).
- User-agent / gateway protocol questions: follow [references/user-agent-mcp-protocol.md](references/user-agent-mcp-protocol.md).
- Reporting setup results to the user: use [references/install-report-template.md](references/install-report-template.md).

## Workflow

### 1. Preflight

- Confirm `node >= 20.17.0` and `npm` are available.
- Check `dot` (Graphviz) and `plantuml` when diagram rendering is needed.
- If the repo is missing, clone or guide the user to obtain it.

### 2. Install and Build

1. `npm install`
2. Create `.env` from `.env.example` if `.env` is missing.
3. `npm run build`
4. Prepare the MCP client entry: `node /absolute/path/to/dist/index.js --stdio`

### 3. Configure Credentials

Minimum `.env`:

```dotenv
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_AUTH_TYPE=tenant
MCP_MODE=auto
```

Do not block on missing credentials if the user only wants to verify the build. Note which values are still needed and move on.

### 4. Verify

Run these MCP tool calls in order. Stop at the first failure and diagnose:

| Step | Tool call | Pass condition |
|------|-----------|----------------|
| 1 | `ping` | Returns success |
| 2 | `auth_status` | Shows configured app ID and auth type |
| 3 | `auth_status` with `fetchToken: true` | Returns a valid access token |
| 4 | `get_document_info` on a known doc | Returns document metadata |

**Diagnosis guide:**

| Failure point | Likely cause | Fix |
|---------------|-------------|-----|
| Step 1 fails | MCP transport not connected | Check client config path, rebuild |
| Step 2 fails | `.env` not loaded or missing vars | Verify `.env` exists and is complete |
| Step 3 fails | Wrong app credentials or app not approved | Check App ID/Secret in Feishu console |
| Step 4 fails | Insufficient app permissions or wrong doc ID | Check Feishu app scopes, doc sharing |

### 5. Report

Use the template in [references/install-report-template.md](references/install-report-template.md). Always include:

- Absolute file paths for generated/updated files
- Whether proxy env vars (`HTTP_PROXY`, `HTTPS_PROXY`) were detected
- Explicit list of missing credentials or prerequisites
- Concrete next-step recommendation

## Guardrails

- Keep absolute file paths when reporting files.
- Prefer `MCP_MODE=auto` with `--stdio` unless the user explicitly wants HTTP.
- Treat Graphviz and PlantUML readiness as part of install health only when diagram features are requested.
- Do not dump raw MCP tool output — always add a short explanatory sentence.
- In shared HTTP mode, clarify that `MCP_HTTP_AUTH_TOKEN` is transport access control, not user identity.
