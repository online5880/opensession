# OpenSession

OpenSession is an execution continuity layer for AI agent operations.

It helps teams keep work moving across tools and environments with a stable session model:
- start/resume anywhere,
- durable event timeline,
- handoff-friendly context,
- operational status visibility.

---

## Quick Start

```bash
npx @online5880/opensession init
npx @online5880/opensession sync --project demo
npx @online5880/opensession start --project-key demo --actor mane
npx @online5880/opensession status --project-key demo
npx @online5880/opensession log --limit 50
```

### Short Alias (recommended)

```bash
alias opss='npx -y @online5880/opensession'
opss init
opss sync --project demo
opss start --project-key demo --actor mane
opss status --project demo
opss log --limit 50
```

---

## Core Commands

- `init` — configure Supabase URL/key and validate connection
- `sync --project <key>` — sync local/remote state
- `start --project-key <key> --actor <name>` — start a new session
- `resume --session-id <id> --actor <name>` — resume session
- `status --project-key <key>` / `status --project <key>` — status + sync info
- `log --session-id <id> --limit <n>` — event log
- `self-update` — check/install latest package version
- `viewer --host <host> --port <port>` — read-only local web viewer
- `config-path` — print config location

---

## Supabase Setup

`init` asks for:
- Supabase URL: `https://<project-ref>.supabase.co`
- Publishable key: `sb_publishable_...`

If you get `PGRST205` (table not found), apply schema once for the project, then rerun:

```bash
opss init
opss sync --project demo
```

---

## Troubleshooting

### `PGRST205`
Schema/tables are missing in current project.

### `Missing project key`
Provide `--project` / `--project-key` or run `sync` first.

### Auth / network failure
Check URL format, key, DNS/network reachability.

---

## Web Surfaces

- Read-only viewer runs locally via `opss viewer`
- Tailscale test URL (environment-specific):
  - `https://maneui-macmini-1.tailefb230.ts.net:5880`

Cloudflare landing/docs deployment is tracked in project issues and may use temporary fallback URLs while auth is being finalized.

---

## Git Hygiene

Do not commit runtime artifacts:
- `artifacts/`
- `.qa/`
- `*.log`, `*.exit`, screenshots, raw runtime dumps

Keep only source/docs/config in git. Put evidence in issue comments and external artifact storage.

---

## Package

- npm: `@online5880/opensession`
- bin: `opensession`, `opss`

