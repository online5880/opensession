# @online5880/opensession

MVP CLI for session continuity with Supabase.

## Commands

- `init [--project-key] [--actor]` (프롬프트로 URL/ANON KEY 입력)
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

Apply `sql/schema.sql` in Supabase SQL editor before using the CLI.

## npx 실행

```bash
npx @online5880/opensession init
```
