# @online5880/opensession

MVP CLI for session continuity with Supabase.

## Commands

- `init [--project-key] [--actor]` (프롬프트로 URL/ANON KEY 입력)
- `login --actor`
- `start --project-key [--project-name] [--actor]`
- `resume --session-id [--actor]`
- `status [--project-key|--project]`
- `self-update [--check]`
- `viewer [--host] [--port]`
- `sync --project <name>`
- `log [--session-id] [--limit]`

## Quick start

### npx flow (5 commands)

```bash
npx @online5880/opensession init --project-key demo --actor mane
# prompt 1: Supabase URL을 입력하세요: https://<project-ref>.supabase.co
# prompt 2: Supabase ANON KEY를 입력하세요: eyJ...
npx @online5880/opensession login --actor mane
npx @online5880/opensession start --project-key demo --project-name demo
npx @online5880/opensession status
npx @online5880/opensession log
```

### 2-minute quickstart

1. Run `init` once and enter your Supabase URL/ANON key.
2. Run `login --actor <name>` to set your actor.
3. Run `start --project-key <key>` to create/open the current session.
4. Run `status` to confirm active sessions and CLI version status.
5. Run `viewer --host 127.0.0.1 --port 8787` and open `http://127.0.0.1:8787`.

`start --project-key demo` stores `demo` as the default project key and the last session id.
After that, `status` and `log` work without extra project/session flags.
For explicit project selection in status, both `--project-key demo` and `--project demo` are supported.
`status` also prints current CLI version and latest npm version.
Use `self-update --check` to check updates without installing, or `self-update` to run global npm update.
Use `viewer` to open a minimal read-only web UI for projects/sessions/events.
The dashboard includes usage summary, session details, and an events tail panel.

```bash
npx @online5880/opensession viewer --host 127.0.0.1 --port 8787
# open http://127.0.0.1:8787
# optional query params:
#   ?tail=200        (latest event count, 1..500)
#   ?refresh=5       (auto refresh seconds, 0..60)
```

If `init` prints a schema-related error (for example `PGRST205`), apply `sql/schema.sql` in Supabase SQL editor, then run `init` again.

## Common errors and fixes

- `PGRST205` or missing `public.projects`:
  apply `sql/schema.sql` in Supabase SQL editor, then rerun `init`.
- Auth/connection failure during `init`:
  verify Supabase URL format (`https://<project-ref>.supabase.co`) and ANON key value, then retry.
- `Missing project key` in `status`:
  run `start --project-key <key>` first, or pass `status --project <key>`.

## Tailscale testing URL rule

Use two-step verification:
1. Prove local serve first with `http://127.0.0.1:<port>`.
2. Validate external access separately via the Tailscale URL on manager/host network.

Do not treat a Tailscale DNS issue in isolated runtime as a product failure if local serve is PASS.

## npx 실행

```bash
npx @online5880/opensession init
```
