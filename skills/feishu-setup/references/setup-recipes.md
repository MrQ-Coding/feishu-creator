# Setup Recipes

Use this reference when the user wants to install, initialize, configure, or health-check `feishu-creator`.

## Preflight

- Confirm `node` and `npm` exist and that Node is `>= 20.17.0`.
- Prefer `git` for source retrieval when the repo is missing.
- Check `dot` and `plantuml` availability when diagram rendering matters.

## Bootstrap

1. Run `npm install`.
2. Create `.env` from `.env.example` if `.env` is missing.
3. Build with `npm run build`.
4. Prepare the MCP client entry with `node /absolute/path/to/dist/index.js --stdio`.

## Minimum Env

```dotenv
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_AUTH_TYPE=tenant
MCP_MODE=auto
```

## Suggested Verification Path

1. `ping`
2. `auth_status`
3. `auth_status` with `{ "fetchToken": true }`
4. `get_document_info`

If the first three pass and the fourth fails, suspect Feishu auth scope, document permissions, or the target document ID before suspecting MCP transport.

## Reporting Checklist

- Environment and Node version
- Repo location
- Install and build result
- Files created or updated
- Startup smoke result
- Remaining manual inputs
- Next step recommendation
