# OpenSession

OpenSession is an **Execution Continuity Layer** for teams shipping with coding agents.

It gives operators one continuity system across CLI, automation, and lightweight web/TUI views so delivery does not fragment when sessions, terminals, or contributors change.

## Product Messaging

OpenSession is designed for one specific outcome: **ship continuously even when runtime context breaks**.

When teams run coding agents and humans together, context breaks in predictable places:
- shell sessions die,
- ownership changes mid-task,
- updates are spread across chat/tools,
- handoffs lose the exact action chain.

OpenSession stores execution state and event history in Supabase, then exposes it through a CLI-first operator surface for fast resume and clean handoff.

## MVP-20 Implementation Flow

This is the default execution loop used for MVP rollout and team operations:

1. Bootstrap continuity layer: run `init`, connect Supabase, verify schema.
2. Establish project scope: run `sync --project <key>` and confirm linkage.
3. Open or resume active execution: `start` for new runs, `resume` for interrupted runs.
4. Operate with visibility: use `status`, `log`, `ops`, and `report` to manage handoff and throughput.

Delivery objective: each workstream should be executable by any teammate with the same project key and actor metadata, without losing intent->action->artifact history.

## Who This Is For

- Small engineering teams shipping with AI agents daily.
- Operators managing multiple active tasks and handoffs.
- Founders/PMs who need execution visibility without opening every terminal.

## Core Pains We Solve

- Losing task context between sessions or machines.
- Weak handoff quality between human and agent shifts.
- No durable timeline of intent -> action -> artifact.
- Difficult weekly reporting of operational throughput.

## Product Differentiators

- Continuity-first model (not just chat logs).
- CLI-native workflow with read-only web visibility.
- Durable event timeline in Supabase with project/session structure.
- Built-in operational commands (`status`, `log`, `report`, `ops`) for day-to-day execution.

## MVP Boundaries

### Included in MVP

- Supabase-backed project/session/event persistence.
- CLI for init, sync, start, resume, status, log, report.
- Read-only viewer for session/event inspection.
- Keyboard-driven ops TUI for operator loops.
- Webhook ingestion + outbound automation hooks.

### Not Included in MVP

- Full visual workflow builder.
- Advanced RBAC/enterprise auth model.
- Native billing/invoice automation.
- Multi-region data residency controls.

## Data Model (MVP)

OpenSession expects these tables in `public` schema:
- `projects`
- `sessions`
- `session_events`

Minimal conceptual model:

- `projects`: stable workspace key and metadata.
- `sessions`: active/ended execution containers tied to actor + project.
- `session_events`: ordered timeline entries (intent, action, artifact, webhook, status changes).

## Quick Start

### Prerequisites

- Node.js 18+
- A Supabase project with schema applied

### Install/Run

```bash
npx @online5880/opensession init
npx @online5880/opensession sync --project demo
npx @online5880/opensession start --project-key demo --actor mane
npx @online5880/opensession status --project-key demo
npx @online5880/opensession log
npx @online5880/opensession ops --project-key demo
```

`init` asks for:
- Supabase URL: `https://<project-ref>.supabase.co`
- Supabase key: `sb_publishable_...`

### Live URLs / Package

- Landing + docs URL: `https://online5880.github.io/opensession/`
- npm package: `@online5880/opensession`
- Current package version in this repo: `0.1.2`

## CLI Command Surface

- `init`: initialize local config + verify connection
- `login`: update stored Supabase credentials
- `sync --project <key>`: ensure local/remote project linkage
- `start --project-key <key> --actor <name>`: create active session
- `resume --session-id <id> --actor <name>`: continue prior session
- `status --project-key <key>`: active session overview
- `log --session-id <id> --limit <n>`: event timeline query
- `report --project-key <key> --days 28 --weeks 6`: KPI + weekly trend summary
- `viewer --host 127.0.0.1 --port 5880`: read-only web viewer
- `ops --project-key <key>`: terminal operations console
- `webhook-server --project-key <key> --port 8788`: inbound event ingestion
- `self-update`: check/install latest package version
- `config-path`: print local config location

## Standard CLI Flows

### Flow 1: First-time bootstrap

```bash
npx @online5880/opensession init
npx @online5880/opensession sync --project demo
npx @online5880/opensession start --project-key demo --actor mane
```

### Flow 2: Resume interrupted execution

```bash
npx @online5880/opensession resume --session-id <session-id> --actor mane
npx @online5880/opensession status --project-key demo
npx @online5880/opensession log --session-id <session-id> --limit 50
```

### Flow 3: Operator monitoring loop

```bash
npx @online5880/opensession ops --project-key demo --refresh-ms 5000 --limit 50
npx @online5880/opensession report --project-key demo --days 28 --weeks 6
```

### Flow 4: External event ingestion

```bash
npx @online5880/opensession webhook-server --project-key demo --port 8788
curl -X POST http://127.0.0.1:8788/webhooks/event \
  -H 'content-type: application/json' \
  -d '{"source":"github","eventType":"github.push","projectKey":"demo","payload":{"ref":"refs/heads/main"}}'
```

## Pricing Draft (Working)

This is a draft packaging model for validation and may change.

- `Starter` (individual / trial): $0-$19/mo target
  - 1 workspace
  - basic CLI continuity + viewer
- `Team` (core ICP): $99/mo target
  - up to 10 active operators
  - full CLI + ops + report + webhook automation
- `Scale` (design partner): custom pricing
  - custom limits, onboarding support, SLA discussion

## 30-Day Plan (Execution)

### Days 1-10

- Stabilize onboarding: reduce `init` + schema friction.
- Finalize README/landing positioning consistency.
- Improve error messages around Supabase auth/schema checks.

### Days 11-20

- Harden WebUI and Ops TUI for daily operator use.
- Add clearer handoff packet/event labeling conventions.
- Expand report outputs for weekly decision-making.

### Days 21-30

- Validate pricing assumptions with pilot users.
- Ship 2-3 end-to-end demos (interrupt/resume/handoff scenarios).
- Prepare MVP launch checklist and publish narrative docs.

## Config Path

```bash
npx @online5880/opensession config-path
```

Default location:
- macOS/Linux: `~/.opensession/config.json`
- Windows: `%USERPROFILE%\\.opensession\\config.json`

## Common Errors

### `PGRST205` table not found

Cause: schema not applied to Supabase project.

Fix:
```bash
npx @online5880/opensession init
npx @online5880/opensession sync --project demo
```

### `Missing project key`

Cause: project not selected.

Fix:
```bash
npx @online5880/opensession sync --project demo
# or
npx @online5880/opensession status --project-key demo
```

### Auth/network failures

- Confirm URL is `https://<project-ref>.supabase.co`
- Confirm key format is valid
- Re-run `init` or `login`

## Short Alias

```bash
alias opss='npx -y @online5880/opensession'
opss init
opss sync --project demo
opss start --project-key demo --actor mane
opss status --project-key demo
opss log
```

If published with the `opss` bin, you can also run `npx opss ...`.
