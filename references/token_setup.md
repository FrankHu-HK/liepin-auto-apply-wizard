# Step-by-Step Token Guide (Stage 0)

> The only prerequisite of this skill: an `x-user-token` (JWT) of your own Liepin account. The token plaintext is passed inline in this command only via env `LIEPIN_TOKEN`, **not persisted, not memorized, not logged**.

## Steps (~2 minutes)

1. **Log in to Liepin and open the MCP server page**
   - Browser open: https://www.liepin.com/mcp/server
   - If not logged in, scan QR / SMS login to your Liepin account first.

2. **Generate credentials**
   - Click "Generate credentials" or "Create Token" button on the page.
   - If prompted to select permissions, **be sure to check `user-search-job` and `user-apply-job`** (the latter is delivery permission; missing it returns 401).

3. **Copy x-user-token**
   - Copy the generated JWT string (starts with `eyJ`, usually very long).
   - Send it directly to the chat, or pass it inline on the command line as below.

## How to use

**Method A: Send directly to the WorkBuddy agent**
- Copy the token to the chat; the agent will inject `LIEPIN_TOKEN` and run the scripts.

**Method B: Manual command line**
```powershell
$env:LIEPIN_TOKEN="eyJ...your token..."
node scripts/apply_pipeline.js
```

```bash
# Linux / macOS
export LIEPIN_TOKEN="eyJ...your token..."
node scripts/apply_pipeline.js
```

## FAQ

- **Q: How long is the Token valid?**
  - Nominal 90 days, but high-frequency bulk requests may be revoked early by the server. If delivery returns 401, regenerate by the steps above.

- **Q: Why does search work but apply returns 401?**
  - Liepin may separate search and delivery permissions. When regenerating credentials, confirm **apply permission** is checked.

- **Q: Will the Token be saved?**
  - No. The script only reads the current env `LIEPIN_TOKEN`, not kept after.

- **Q: Don't want to copy token every time?**
  - You can use a workspace `.env` file or OS env var management, but **don't commit to Git / public repos**.
