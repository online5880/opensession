# opensession

MVP CLI for session continuity with Supabase.

## Commands

- `init --url --anon-key [--project-key] [--actor]`
- `login --actor`
- `start --project-key [--project-name] [--actor]`
- `resume --session-id [--actor]`
- `status [--project-key]`
- `log [--session-id] [--limit]`

## Quick start

```bash
npm install
node src/cli.js init --url "$SUPABASE_URL" --anon-key "$SUPABASE_ANON_KEY" --project-key demo --actor mane
node src/cli.js start --project-key demo
node src/cli.js status
node src/cli.js log
```

Apply `sql/schema.sql` in Supabase SQL editor before using the CLI.
