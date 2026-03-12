# OpenSession

OpenSession is an execution-continuity OS for CLI workflows: it records session metadata and events, then lets you list, inspect, tail, and resume work consistently across local and remote environments.

It helps teams and agents:
- start/resume sessions across environments,
- keep a durable timeline in Supabase,
- inspect progress via CLI (and viewer/TUI surfaces),
- avoid context loss across runtime/session changes.

## Package + Docs

- npm package: `@online5880/opensession`
- latest package version (as of this README update): `0.1.1`
- package page: https://www.npmjs.com/package/@online5880/opensession
- landing/docs source: https://github.com/online5880/opensession

## Quickstart (2 minutes, npx-first + `opss` alias)

### Prerequisites
- Node.js 18+
- A Supabase project

### Create alias

```bash
alias opss='npx @online5880/opensession'
```

### Run

```bash
opss init --project-key demo --actor mane
# prompt 1: Supabase URL, e.g. https://<project-ref>.supabase.co
# prompt 2: Supabase anon key, e.g. eyJ...

opss start --project-key demo --project-name demo
opss sessions --project demo --limit 10
opss inspect --tail 20
opss st --project demo
```

`start --project-key demo` stores `demo` as default project key and the latest session id. After that, `status` and `log` can run without extra project/session flags. Both flag forms are accepted where supported: `--project-key demo` and `--project demo`.

## Supabase Setup (URL/key + schema/bootstrap path)

1. Run `opss init --project-key <key> --actor <name>`.
2. Enter Supabase URL (`https://<project-ref>.supabase.co`) and anon key.
3. Apply schema bootstrap SQL at [`sql/schema.sql`](sql/schema.sql).
4. Optional automatic bootstrap path:
   `SUPABASE_MANAGEMENT_TOKEN=<token> SUPABASE_PROJECT_REF=<project-ref> opss init --project-key <key> --actor <name>`

## Core Commands

- `init|setup [--project-key] [--actor]`
- `login --actor`
- `start --project-key [--project-name] [--actor]`
- `resume --session-id [--actor]`
- `list|sessions [--project-key|--project] [--limit]`
- `view|inspect [--session-id] [--project-key|--project] [--tail]`
- `tail|follow [--session-id] [--project-key|--project] [--limit] [--interval] [--iterations]`
- `status|st [--project-key|--project]`
- `sync [--project|--project-key]`
- `log|logs [--session-id] [--limit]`
- `self-update [--check]`
- `viewer [--host] [--port]`
- `webhook-server [--project-key] [--port]`
- `report [--project-key] [--days] [--weeks] [--json]`
- `config-path`

## Common Errors and Fixes

- `PGRST205` during `init` or first remote query:
  Apply [`sql/schema.sql`](sql/schema.sql) in Supabase SQL editor, then rerun `init`.
- Auth/config error (`Supabase is not configured. Run opensession init first.`):
  Run `opss init --project-key <key> --actor <name>` (or `npx @online5880/opensession init ...`) and provide URL + anon key.
- Missing project key error:
  Pass `--project` or `--project-key`, or run `start` once to set a default project.

## Viewer

```bash
npx @online5880/opensession viewer --host 127.0.0.1 --port 8787
# open http://127.0.0.1:8787
# optional query params:
#   ?tail=200
#   ?refresh=5
```

## Tailscale Test Link Rule

When posting QA/test links in issue comments, use the Tailscale URL form only (not localhost):

- `https://maneui-macmini-1.tailefb230.ts.net:5880`

## Config Location

Show local config path:

```bash
npx @online5880/opensession config-path
```

Default location:
- macOS/Linux: `~/.opensession/config.json`
- Windows: `%USERPROFILE%\\.opensession\\config.json`
