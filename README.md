# OpenSession

OpenSession is a lightweight session continuity layer for teams and agents.

It helps you:
- start and resume work sessions across environments,
- keep a durable event timeline in Supabase,
- inspect progress via CLI (and viewer/TUI as they mature),
- avoid losing context when runtime/session changes.

---

## 1) Quick Start (2 minutes)

### Prerequisites
- Node.js 18+
- A Supabase project

### Run
```bash
npx @online5880/opensession init
npx @online5880/opensession sync --project demo
npx @online5880/opensession start --project-key demo --actor mane
npx @online5880/opensession status --project-key demo
npx @online5880/opensession log
```

`init` will ask for:
- Supabase URL (`https://<project-ref>.supabase.co`)
- Supabase publishable/anon key (`sb_publishable_...`)

---

## 2) Core Commands

### `init`
Initialize local config and validate Supabase connection.

```bash
npx @online5880/opensession init
```

### `sync`
Sync local state with remote project.

```bash
npx @online5880/opensession sync --project demo
```

### `start`
Start a new active session.

```bash
npx @online5880/opensession start --project-key demo --actor mane
```

### `resume`
Resume an existing session by ID.

```bash
npx @online5880/opensession resume --session-id <session-id> --actor mane
```

### `status`
Show active sessions + sync metadata.

```bash
npx @online5880/opensession status --project-key demo
```

### `log`
Read recent events in a session.

```bash
npx @online5880/opensession log --session-id <session-id> --limit 50
```

### `self-update`
Check/install latest global version.

```bash
npx @online5880/opensession self-update
```

### `viewer`
Run read-only web viewer locally.

```bash
npx @online5880/opensession viewer --host 127.0.0.1 --port 5880
```

---

## 3) Config Location

Local config file:

```bash
npx @online5880/opensession config-path
```

Default location:
- macOS/Linux: `~/.opensession/config.json`
- Windows: `%USERPROFILE%\\.opensession\\config.json`

---

## 4) Supabase Setup Notes

OpenSession expects these tables in `public` schema:
- `projects`
- `sessions`
- `session_events`

If you see `PGRST205` (`table ... not found`), your schema is not applied yet.

Current safe recovery:
1. Apply schema SQL (once per Supabase project)
2. Re-run `init` and `sync`

(Automatic bootstrap flow is being hardened in ongoing Phase work.)

---

## 5) Common Errors

### `PGRST205` (table not found)
Cause: schema missing.
Fix: apply schema SQL once, then run:
```bash
npx @online5880/opensession init
npx @online5880/opensession sync --project demo
```

### `Missing project key`
Cause: no project specified yet.
Fix:
```bash
npx @online5880/opensession sync --project demo
# or
npx @online5880/opensession status --project-key demo
```

### Auth/network errors
Cause: invalid URL/key, DNS, or connectivity.
Fix:
- confirm URL is `https://<project-ref>.supabase.co`
- confirm key starts with `sb_publishable_`
- retry `init`

---

## 6) Operational Tips

- Prefer small, frequent commits and push often.
- Keep updates reproducible: include command and output snippets.
- For remote demo links in this environment, share Tailscale URL (not localhost).

---

## 7) Versioning

- Package: `@online5880/opensession`
- Suggested release flow:
  1. update version
  2. changelog/checkpoint note
  3. publish
  4. smoke-test via `npx`

---

## 8) Project Status

OpenSession is actively evolving.
Current focus:
- WebUI/TUI hardening
- bootstrap reliability
- docs and operator UX polish



## Short Alias (recommended)

```bash
alias opss='npx -y @online5880/opensession'
opss init
opss sync --project demo
opss start --project-key demo --actor mane
opss status --project-key demo
opss log
```

When published with the `opss` bin, you can also use `npx opss ...` directly.
