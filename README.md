# @online5880/opensession

MVP CLI for session continuity with Supabase.

## Commands

- `init [--project-key] [--actor]` (interactive URL + publishable key prompt)
- `login --actor`
- `start --project-key [--project-name] [--actor]`
- `resume --session-id [--actor]`
- `status [--project-key]`
- `sync --project <name>`
- `log [--session-id] [--limit]`

## Quick start

```bash
npm install
node src/cli.js init --project-key demo --actor mane
node src/cli.js sync --project demo
node src/cli.js start --project-key demo
node src/cli.js status
node src/cli.js log
```

## Schema bootstrap

`opensession init` validates the connection immediately after saving credentials.

- If schema exists: validation passes and setup is complete.
- If schema is missing (`PGRST205`): CLI offers bootstrap options.
1. Option A: provide Supabase Management API token + project ref for automatic schema apply.
2. Option B: print exact one-step command and SQL file path (`sql/schema.sql`) for manual apply.

After Option A bootstrap, connection validation is retried automatically.

## npx

```bash
npx @online5880/opensession init
```
