# 🌐 OpenSession

**[English](README.md) | [한국어](README.ko.md)**

> **The Execution Continuity Layer for AI Agent Operations**

[![npm version](https://img.shields.io/npm/v/@online5880/opensession.svg?style=flat-square)](https://www.npmjs.com/package/@online5880/opensession)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](#)
[![Built with Supabase](https://img.shields.io/badge/Backend-Supabase-green.svg?style=flat-square)](https://supabase.com)

**OpenSession** is an execution continuity layer designed to help AI agents maintain context and workflow stability across different tools, environments, and network conditions.

---

## 🚀 Why OpenSession?

The biggest challenge in collaborating with AI agents is **"Context Fragmentation."**
- What happens if you move an agent from local to a remote server?
- What if the session drops due to network issues?
- How do you track the flow across multiple tools with disparate logs?

**OpenSession solves this.** By using a single session ID, all activities are persisted to Supabase, allowing you to monitor and resume work seamlessly via CLI, Web, or TUI.

---

## ✨ Key Capabilities

### 1. Stable Session Model
- Resume work anywhere using the same `session_id`.
- Native support for `start` -> `pause` -> `resume` workflows.

### 2. Durable Event Timeline
- **Intent**: What is the goal?
- **Action**: What command was executed?
- **Artifact**: What was produced?
- All elements are recorded in structured JSON for deep analysis.

### 3. Multi-Surface Monitoring
- **CLI**: Intuitive terminal-based control.
- **WebUI (Viewer)**: High-resolution timeline dashboard in your browser.
- **TUI (Terminal UI)**: Keyboard-driven interactive dashboard inside your terminal.

### 4. Enterprise-Grade Reliability
- **Idempotency**: Prevents duplicate event recording.
- **Exponential Backoff**: Automatic retries for unstable network scenarios.

---

## 🗺️ Roadmap: The 3-Layer Interface

| Phase | Surface | Status | Features |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **CLI Core** | ✅ Stable | Session control, basic logging, config management |
| **Phase 2** | **WebUI Viewer** | ✅ Stable | Dark theme, KPI reports, JSON payload viewer |
| **Phase 3** | **Interactive TUI** | ✅ Active | Real-time session switching, live event streaming |

### Installation & Setup

#### 1. Alias / Function Setup
To use the `opss` shorthand, add the following to your shell profile:

**macOS / Linux (Bash/Zsh):**
```bash
alias opss='npx -y @online5880/opensession'
```

**Windows (PowerShell):**
```powershell
function opss { npx -y @online5880/opensession @args }
```

#### 2. Global Install (Optional)
```bash
npm install -g @online5880/opensession
```

---

## 🚀 1-Minute Quickstart

1. **Initialize**: Set up your Supabase URL and API Key.
   ```bash
   opss init
   ```

2. **Start Session**: Begin a new project session.
   ```bash
   opss start --project-key my-ai-lab --actor mane
   ```

3. **Log Events**: Record agent activities.
   ```bash
   opss log --limit 10
   ```

4. **Launch Dashboard**: Choose your preferred view.
   ```bash
   opss tui      # Terminal dashboard (Recommended)
   opss viewer   # Web browser viewer
   ```

---

## 📖 Command Reference

| Command | Alias | Description |
| :--- | :--- | :--- |
| `init` | `setup` | Initialize Supabase connection and local config. |
| `start` | `st` | Create a new session and start the timeline. |
| `resume` | `rs` | Resume an existing session with idempotency protection. |
| `tui` | - | **(New)** Launch the interactive Terminal UI dashboard. |
| `viewer` | `vw` | Run a local read-only web viewer server. |
| `status` | `ps` | Check CLI version and active session status. |
| `report` | - | Generate 28-day KPI stats and weekly trend analysis. |

---

## 🏗️ Architecture

OpenSession acts as a high-reliability bridge between agent runtimes and persistent storage.

```mermaid
graph TD
    Agent[AI Agent / Developer] -->|Log/Control| CLI[OpenSession CLI]
    CLI -->|Persist| DB[(Supabase Cloud)]
    DB -->|Stream| TUI[TUI Dashboard]
    DB -->|Render| Web[Web Viewer]
```

---

## 🤝 Contributing

Contributions are welcome! Please use [GitHub Issues](https://github.com/online5880/opensession/issues) for bug reports and feature requests.

MIT © [online5880](https://github.com/online5880)
