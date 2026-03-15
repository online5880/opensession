import http from 'node:http';
import { URL } from 'node:url';
import { getConfigPath, readConfig } from './config.js';
import { computeKpis, computeWeeklyTrend } from './metrics.js';
import { getClient, getSessionEvents, listProjects, listSessionEvents, listSessions } from './supabase.js';

const CSS = `
:root {
  --bg: #080b12;
  --panel: #121a28;
  --panel-light: #182234;
  --text: #e9f1ff;
  --muted: #99abc9;
  --line: #22314a;
  --brand: #64d6ff;
  --accent: #8c7bff;
  --success: #37d67a;
  --error: #ff4d4d;
}
body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: var(--bg); color: var(--text); }
header { padding: 16px 20px; background: var(--panel); border-bottom: 1px solid var(--line); }
header h1 { margin: 0; font-size: 18px; color: var(--brand); }
header p { margin: 6px 0 0; font-size: 13px; color: var(--muted); }
main { display: grid; grid-template-columns: 280px 320px 1fr; gap: 12px; padding: 12px; height: calc(100vh - 80px); }
section { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
section h2 { margin: 0; padding: 12px; font-size: 14px; border-bottom: 1px solid var(--line); background: var(--panel-light); color: var(--brand); }
.scroll-area { flex: 1; overflow-y: auto; }
ul { list-style: none; margin: 0; padding: 0; }
li { border-bottom: 1px solid var(--line); }
li:last-child { border-bottom: 0; }
a.item { display: block; padding: 12px; color: inherit; text-decoration: none; transition: background 0.2s; }
a.item:hover { background: var(--panel-light); }
a.item.active { background: rgba(140, 123, 255, 0.15); border-left: 3px solid var(--accent); }
.meta { display: block; margin-top: 4px; font-size: 11px; color: var(--muted); }
.status-badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; text-transform: uppercase; }
.status-active { background: rgba(55, 214, 122, 0.2); color: var(--success); }
.status-completed { background: rgba(100, 214, 255, 0.2); color: var(--brand); }
.panel-empty { padding: 20px; color: var(--muted); font-size: 13px; text-align: center; }
.summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 12px; }
.summary-card { background: var(--panel-light); border: 1px solid var(--line); border-radius: 8px; padding: 10px; }
.summary-card .label { font-size: 10px; color: var(--muted); text-transform: uppercase; }
.summary-card .value { font-size: 16px; font-weight: bold; margin-top: 4px; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 10px; font-size: 12px; color: var(--muted); background: var(--panel-light); position: sticky; top: 0; }
td { padding: 10px; font-size: 12px; border-bottom: 1px solid var(--line); }
code { font-family: "JetBrains Mono", monospace; color: var(--brand); font-size: 11px; }
pre { margin: 0; white-space: pre-wrap; word-break: break-all; color: var(--text); }
@media (max-width: 1080px) {
  main { grid-template-columns: 1fr; height: auto; }
}
`;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toPrettyJson(value) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return '{}';
  }
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === 'object') {
    const message = error.message;
    const details = error.details;
    const hint = error.hint;
    const code = error.code;
    const parts = [message, details, hint, code].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(' | ');
    }
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown object error';
    }
  }
  return String(error);
}

function toIntegerInRange(raw, fallback, min, max) {
  const value = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isInteger(value)) {
    return fallback;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function normalizeStatusFilter(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'active' || value === 'ended') {
    return value;
  }
  return 'all';
}

function normalizeActorFilter(raw) {
  const value = String(raw ?? '').trim();
  return value.slice(0, 64);
}

function aggregateEventsByType(events) {
  const counts = new Map();
  for (const event of events) {
    const key = String(event.type ?? 'unknown');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count]) => ({ type, count }));
}

function aggregateSessionsByActor(sessions) {
  const counts = new Map();
  for (const session of sessions) {
    const key = String(session.actor ?? 'unknown');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([actor, count]) => ({ actor, count }));
}

function truncateText(value, maxLength) {
  const text = String(value ?? '');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1))}...`;
}

function hasAnyKeyword(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function classifyEventStage(event) {
  const type = String(event?.type ?? '').toLowerCase();
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  const payloadKeys = Object.keys(payload).map((key) => key.toLowerCase()).join(' ');
  const payloadText = `${toPrettyJson(payload).toLowerCase()} ${payloadKeys}`;
  const search = `${type} ${payloadText}`;

  const artifactKeywords = ['artifact', 'output', 'result', 'report', 'diff', 'commit', 'patch', 'release', 'file', 'url'];
  const intentKeywords = ['intent', 'goal', 'plan', 'scope', 'brief', 'task', 'spec', 'decision'];
  const actionKeywords = ['action', 'run', 'exec', 'command', 'webhook', 'sync', 'start', 'resume', 'status', 'deploy', 'build', 'test'];

  if (hasAnyKeyword(search, artifactKeywords)) {
    return 'artifact';
  }
  if (hasAnyKeyword(search, intentKeywords)) {
    return 'intent';
  }
  if (hasAnyKeyword(search, actionKeywords)) {
    return 'action';
  }
  return 'context';
}

function summarizeEventPayload(payload) {
  if (payload === null || payload === undefined) {
    return '-';
  }
  if (typeof payload === 'string') {
    return truncateText(payload, 140);
  }
  if (typeof payload !== 'object') {
    return truncateText(String(payload), 140);
  }

  const preferredKeys = ['summary', 'message', 'title', 'intent', 'action', 'artifact', 'eventType', 'source', 'status', 'path', 'url', 'ref'];
  const parts = [];
  for (const key of preferredKeys) {
    if (parts.length >= 3) {
      break;
    }
    if (!(key in payload)) {
      continue;
    }
    const raw = payload[key];
    if (raw === null || raw === undefined) {
      continue;
    }
    if (typeof raw === 'object') {
      parts.push(`${key}=${truncateText(toPrettyJson(raw), 64)}`);
      continue;
    }
    parts.push(`${key}=${truncateText(String(raw), 64)}`);
  }

  if (parts.length > 0) {
    return truncateText(parts.join(' | '), 160);
  }

  const keys = Object.keys(payload);
  if (keys.length === 0) {
    return '{}';
  }
  const preview = keys.slice(0, 3).map((key) => `${key}=${truncateText(String(payload[key]), 48)}`);
  return truncateText(preview.join(' | '), 160);
}

function gatherPayloadTextCandidates(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const candidates = [];
  for (const [key, value] of Object.entries(payload)) {
    const lowerKey = key.toLowerCase();
    if (typeof value === 'string') {
      candidates.push({ key: lowerKey, value });
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          candidates.push({ key: lowerKey, value: item });
        }
      }
    }
  }
  return candidates;
}

function extractNextActions(events) {
  const priorityKeys = ['nextaction', 'nextactions', 'todo', 'todos', 'actionitems', 'followup', 'followups', 'openitems'];
  const actions = [];
  for (const event of [...events].reverse()) {
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : null;
    const candidates = gatherPayloadTextCandidates(payload);
    for (const item of candidates) {
      const normalized = String(item.value ?? '').trim().replace(/\s+/g, ' ');
      if (!normalized) {
        continue;
      }
      if (priorityKeys.includes(item.key)) {
        actions.push(normalized);
        continue;
      }
      const lower = normalized.toLowerCase();
      if (lower.startsWith('next:') || lower.startsWith('todo:') || lower.startsWith('follow-up:') || lower.startsWith('action:')) {
        actions.push(normalized.replace(/^[^:]+:\s*/i, ''));
      }
    }
    if (actions.length >= 6) {
      break;
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const action of actions) {
    const key = action.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(action);
    if (deduped.length >= 4) {
      break;
    }
  }
  return deduped;
}

function buildHandoffPacket(selectedSession, chainItems, events) {
  const latestByStage = { intent: null, action: null, artifact: null };
  for (const row of [...chainItems].reverse()) {
    if (!latestByStage[row.stage]) {
      latestByStage[row.stage] = row;
    }
    if (latestByStage.intent && latestByStage.action && latestByStage.artifact) {
      break;
    }
  }

  const nextActions = extractNextActions(events);
  const fallbackActions = [];
  if (latestByStage.intent?.summary) {
    fallbackActions.push(`Validate intent alignment: ${latestByStage.intent.summary}`);
  }
  if (latestByStage.action?.summary) {
    fallbackActions.push(`Continue last action path: ${latestByStage.action.summary}`);
  }
  if (latestByStage.artifact?.summary) {
    fallbackActions.push(`Review latest artifact before handoff: ${latestByStage.artifact.summary}`);
  }

  return {
    actor: selectedSession?.actor ?? '-',
    status: selectedSession?.status ?? '-',
    latestIntent: latestByStage.intent?.summary ?? 'No explicit intent event detected.',
    latestAction: latestByStage.action?.summary ?? 'No explicit action event detected.',
    latestArtifact: latestByStage.artifact?.summary ?? 'No explicit artifact event detected.',
    nextActions: nextActions.length > 0 ? nextActions : fallbackActions.slice(0, 3)
  };
}

function renderApp({
  configPath,
  projects,
  selectedProjectId,
  sessions,
  filteredSessions,
  selectedSessionId,
  selectedSession,
  events,
  projectKpis,
  projectTrend,
  tailLimit,
  refreshSeconds,
  sessionStatusFilter,
  actorFilter,
  loadError
}) {
  const projectItems = projects
    .map((project) => {
      const active = project.id === selectedProjectId ? ' active' : '';
      const href = `/?projectId=${encodeURIComponent(project.id)}`;
      return `<li><a class="item${active}" href="${href}"><strong>${escapeHtml(project.project_key)}</strong><span class="meta">${escapeHtml(project.name)}</span></a></li>`;
    })
    .join('');

  const sessionItems = filteredSessions
    .map((session) => {
      const active = session.id === selectedSessionId ? ' active' : '';
      const href = `/?projectId=${encodeURIComponent(selectedProjectId)}&sessionId=${encodeURIComponent(session.id)}&tail=${tailLimit}&refresh=${refreshSeconds}&sessionStatus=${encodeURIComponent(sessionStatusFilter)}&actor=${encodeURIComponent(actorFilter)}`;
      return `<li><a class="item${active}" href="${href}"><strong>${escapeHtml(session.actor)}</strong><span class="meta">${escapeHtml(session.id)} | ${escapeHtml(session.status)} | ${escapeHtml(session.started_at)}</span></a></li>`;
    })
    .join('');

  const activeSessions = sessions.filter((session) => session.status === 'active').length;
  const endedSessions = sessions.filter((session) => session.status === 'ended').length;
  const latestEventAt = events.length > 0 ? events[events.length - 1].created_at : '-';
  const eventTypeBreakdown = aggregateEventsByType(events);
  const chainItems = events.map((event, index) => ({
    step: index + 1,
    type: String(event.type ?? 'unknown'),
    stage: classifyEventStage(event),
    createdAt: event.created_at,
    summary: summarizeEventPayload(event.payload)
  }));
  const chainStageCounts = chainItems.reduce(
    (acc, row) => {
      acc[row.stage] = (acc[row.stage] ?? 0) + 1;
      return acc;
    },
    { intent: 0, action: 0, artifact: 0, context: 0 }
  );
  const handoffPacket = buildHandoffPacket(selectedSession, chainItems, events);
  const handoffNextActionsHtml =
    handoffPacket.nextActions.length === 0
      ? '<li>No inferred next action. Add explicit `nextAction` or `todo` fields in event payloads.</li>'
      : handoffPacket.nextActions.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const chainRows =
    chainItems.length === 0
      ? '<li class="chain-item"><div class="chain-summary">No events in the selected session.</div></li>'
      : chainItems
          .map(
            (row) =>
              `<li class="chain-item"><div class="chain-top"><span><strong>#${row.step}</strong> <span class="chain-type">${escapeHtml(
                row.type
              )}</span></span><span class="chain-stage ${row.stage}">${escapeHtml(row.stage)}</span><span class="chain-time">${escapeHtml(
                row.createdAt
              )}</span></div><div class="chain-summary">${escapeHtml(row.summary)}</div></li>`
          )
          .join('');
  const topActors = aggregateSessionsByActor(sessions);
  const eventRows = events
    .map(
      (event) =>
        `<tr><td>${escapeHtml(event.created_at)}</td><td>${escapeHtml(event.type)}</td><td><code>${escapeHtml(toPrettyJson(event.payload))}</code></td></tr>`
    )
    .join('');
  const refreshMeta = refreshSeconds > 0 ? `Auto refresh ${refreshSeconds}s` : 'Manual refresh';
  const refreshTag =
    refreshSeconds > 0
      ? `<meta http-equiv="refresh" content="${refreshSeconds}" />`
      : '';
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const statusLabel = sessionStatusFilter === 'all' ? 'All statuses' : sessionStatusFilter;
  const actorLabel = actorFilter || 'All actors';
  const controlsProjectId = selectedProjectId ? `<input type="hidden" name="projectId" value="${escapeHtml(selectedProjectId)}" />` : '';
  const eventBreakdownItems =
    eventTypeBreakdown.length === 0
      ? '<li><span>No events</span><span>0</span></li>'
      : eventTypeBreakdown
          .map((row) => `<li><span><code>${escapeHtml(row.type)}</code></span><span>${row.count}</span></li>`)
          .join('');
  const actorItems =
    topActors.length === 0
      ? '<li><span>No sessions</span><span>0</span></li>'
      : topActors.map((row) => `<li><span>${escapeHtml(row.actor)}</span><span>${row.count}</span></li>`).join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>OpenSession Viewer</title>
    ${refreshTag}
    <style>${CSS}</style>
  </head>
  <body>
    <header>
      <h1>OpenSession Read-Only Viewer</h1>
      <p>Config: ${escapeHtml(configPath)} | Read-only mode (GET only)</p>
      ${
        loadError
          ? `<p>Data load error: ${escapeHtml(loadError)}</p>`
          : ''
      }
    </header>
    <main>
      <section>
        <h2>Projects (${projects.length})</h2>
        ${projects.length === 0 ? '<div class="panel-empty">No projects found.</div>' : `<ul>${projectItems}</ul>`}
      </section>
        <section>
          <h2>Sessions (${filteredSessions.length}/${sessions.length})</h2>
          ${filteredSessions.length === 0 ? '<div class="panel-empty">No sessions match current filter.</div>' : `<ul>${sessionItems}</ul>`}
      </section>
      <div class="content-col">
        <section>
          <h2>Usage Summary</h2>
          <div class="summary-grid">
            <div class="summary-card"><span class="label">Projects</span><span class="value">${projects.length}</span></div>
            <div class="summary-card"><span class="label">Project Sessions</span><span class="value">${sessions.length}</span></div>
            <div class="summary-card"><span class="label">Active Sessions</span><span class="value">${projectKpis?.activeSessions ?? activeSessions}</span></div>
            <div class="summary-card"><span class="label">Ended Sessions</span><span class="value">${endedSessions}</span></div>
            <div class="summary-card"><span class="label">28d Events</span><span class="value">${projectKpis?.totalEvents ?? 0}</span></div>
            <div class="summary-card"><span class="label">28d Actors</span><span class="value">${projectKpis?.uniqueActors ?? 0}</span></div>
            <div class="summary-card"><span class="label">Events / Session</span><span class="value">${(projectKpis?.eventsPerSession ?? 0).toFixed(2)}</span></div>
            <div class="summary-card"><span class="label">Tail Events</span><span class="value">${events.length}</span></div>
            <div class="summary-card"><span class="label">Status Filter</span><span class="value">${escapeHtml(statusLabel)}</span></div>
            <div class="summary-card"><span class="label">Actor Filter</span><span class="value">${escapeHtml(actorLabel)}</span></div>
            <div class="summary-card"><span class="label">Top Event Type</span><span class="value">${escapeHtml(eventTypeBreakdown[0]?.type ?? '-')}</span></div>
            <div class="summary-card"><span class="label">Intent Nodes</span><span class="value">${chainStageCounts.intent}</span></div>
            <div class="summary-card"><span class="label">Action Nodes</span><span class="value">${chainStageCounts.action}</span></div>
            <div class="summary-card"><span class="label">Artifact Nodes</span><span class="value">${chainStageCounts.artifact}</span></div>
          </div>
        </section>
        <section>
          <h2>Weekly Trend (28d)</h2>
          ${
            projectTrend.length === 0
              ? '<div class="panel-empty">No trend data available.</div>'
              : `<table class="trend-table"><thead><tr><th>Week Start</th><th>Sessions</th><th>Actors</th><th>Events</th></tr></thead><tbody>${projectTrend
                  .map(
                    (bucket) =>
                      `<tr><td>${escapeHtml(bucket.weekStart)}</td><td>${bucket.sessions}</td><td>${bucket.uniqueActors}</td><td>${bucket.events}</td></tr>`
                  )
                  .join('')}</tbody></table>`
          }
        </section>
        <section>
          <h2>Viewer Controls</h2>
          <form class="controls" method="get" action="/">
            ${controlsProjectId}
            <div class="controls-grid">
              <label>Session status
                <select name="sessionStatus">
                  <option value="all"${sessionStatusFilter === 'all' ? ' selected' : ''}>all</option>
                  <option value="active"${sessionStatusFilter === 'active' ? ' selected' : ''}>active</option>
                  <option value="ended"${sessionStatusFilter === 'ended' ? ' selected' : ''}>ended</option>
                </select>
              </label>
              <label>Actor contains
                <input name="actor" value="${escapeHtml(actorFilter)}" placeholder="mane" />
              </label>
              <label>Tail events
                <input name="tail" value="${tailLimit}" />
              </label>
              <label>Refresh seconds
                <input name="refresh" value="${refreshSeconds}" />
              </label>
            </div>
            <div class="controls-actions">
              <button class="button" type="submit">Apply</button>
              <a class="button secondary" href="/?projectId=${encodeURIComponent(selectedProjectId ?? '')}">Reset</a>
            </div>
          </form>
        </section>
        <section>
          <h2>Session Details</h2>
          ${
            selectedSession
              ? `<div class="details">
              <div class="details-row"><span class="details-key">Project</span><span>${escapeHtml(selectedProject?.project_key ?? '-')}</span></div>
              <div class="details-row"><span class="details-key">Session ID</span><span><code>${escapeHtml(selectedSession.id)}</code></span></div>
              <div class="details-row"><span class="details-key">Actor</span><span>${escapeHtml(selectedSession.actor)}</span></div>
              <div class="details-row"><span class="details-key">Status</span><span>${escapeHtml(selectedSession.status)}</span></div>
              <div class="details-row"><span class="details-key">Started</span><span>${escapeHtml(selectedSession.started_at)}</span></div>
              <div class="details-row"><span class="details-key">Ended</span><span>${escapeHtml(selectedSession.ended_at ?? '-')}</span></div>
              <div class="details-row"><span class="details-key">Latest Event</span><span>${escapeHtml(latestEventAt)}</span></div>
            </div>`
              : '<div class="panel-empty">Select a session to view details.</div>'
          }
        </section>
        <section>
          <h2>Session Chain (Intent -> Action -> Artifact)</h2>
          ${
            selectedSession
              ? `<ul class="chain-list">${chainRows}</ul>`
              : '<div class="panel-empty">Select a session to inspect the chain.</div>'
          }
        </section>
        <section>
          <h2>Handoff Panel</h2>
          ${
            selectedSession
              ? `<div class="handoff-panel">
                  <div class="handoff-summary">
                    <div class="handoff-summary-row"><span class="handoff-label">Actor</span><span class="handoff-value">${escapeHtml(handoffPacket.actor)}</span></div>
                    <div class="handoff-summary-row"><span class="handoff-label">Status</span><span class="handoff-value">${escapeHtml(handoffPacket.status)}</span></div>
                    <div class="handoff-summary-row"><span class="handoff-label">Intent</span><span class="handoff-value">${escapeHtml(handoffPacket.latestIntent)}</span></div>
                    <div class="handoff-summary-row"><span class="handoff-label">Action</span><span class="handoff-value">${escapeHtml(handoffPacket.latestAction)}</span></div>
                    <div class="handoff-summary-row"><span class="handoff-label">Artifact</span><span class="handoff-value">${escapeHtml(handoffPacket.latestArtifact)}</span></div>
                  </div>
                  <div class="next-actions">
                    <h3>Next Actions</h3>
                    <ol>${handoffNextActionsHtml}</ol>
                  </div>
                </div>`
              : '<div class="panel-empty">Select a session to generate handoff packet summary and next actions.</div>'
          }
        </section>
        <section>
          <h2>Event Type Breakdown</h2>
          <ul class="mini-list">${eventBreakdownItems}</ul>
        </section>
        <section>
          <h2>Actor Session Distribution</h2>
          <ul class="mini-list">${actorItems}</ul>
        </section>
        <section>
          <h2 class="events-header"><span>Events Tail</span><span class="events-meta">${escapeHtml(refreshMeta)} | tail=${tailLimit}</span></h2>
          ${
            events.length === 0
              ? '<div class="panel-empty">Select a session to view events.</div>'
              : `<table><thead><tr><th>Time</th><th>Type</th><th>Payload</th></tr></thead><tbody>${eventRows}</tbody></table>`
          }
        </section>
      </div>
    </main>
  </body>
</html>`;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendHtml(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

export async function startViewerServer({ host, port }) {
  const config = await readConfig();
  const client = getClient(config);
  const configPath = getConfigPath();

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'Method not allowed. Viewer is read-only (GET/HEAD only).' });
        return;
      }

      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`);

      if (url.pathname === '/health') {
        sendJson(res, 200, { ok: true, mode: 'read-only' });
        return;
      }

      if (url.pathname !== '/') {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }

      let projects = [];
      let sessions = [];
      let selectedSession = null;
      let events = [];
      let projectKpis = null;
      let projectTrend = [];
      let loadError = null;

      try {
        projects = await listProjects(client, 100);
      } catch (error) {
        loadError = formatError(error);
      }
      const projectIdFromQuery = url.searchParams.get('projectId');
      const selectedProjectId = projects.some((item) => item.id === projectIdFromQuery)
        ? projectIdFromQuery
        : projects[0]?.id ?? null;

      if (selectedProjectId && !loadError) {
        try {
          sessions = await listSessions(client, selectedProjectId, 200);
          const now = new Date();
          const start = new Date(now);
          start.setUTCDate(start.getUTCDate() - 28);
          const sessionIds = sessions.map((session) => session.id);
          const projectEvents = await listSessionEvents(client, sessionIds, {
            since: start.toISOString(),
            until: now.toISOString(),
            ascending: true
          });
          projectKpis = computeKpis(sessions, projectEvents);
          projectTrend = computeWeeklyTrend(sessions, projectEvents, 4, now);
        } catch (error) {
          loadError = formatError(error);
          sessions = [];
          projectKpis = null;
          projectTrend = [];
        }
      }
      const sessionIdFromQuery = url.searchParams.get('sessionId');
      const tailLimit = toIntegerInRange(url.searchParams.get('tail'), 200, 1, 500);
      const refreshSeconds = toIntegerInRange(url.searchParams.get('refresh'), 0, 0, 60);
      const sessionStatusFilter = normalizeStatusFilter(url.searchParams.get('sessionStatus'));
      const actorFilter = normalizeActorFilter(url.searchParams.get('actor'));
      const actorFilterNeedle = actorFilter.toLowerCase();
      const filteredSessions = sessions.filter((session) => {
        if (sessionStatusFilter !== 'all' && session.status !== sessionStatusFilter) {
          return false;
        }
        if (actorFilterNeedle && !String(session.actor ?? '').toLowerCase().includes(actorFilterNeedle)) {
          return false;
        }
        return true;
      });
      const selectedSessionId = filteredSessions.some((item) => item.id === sessionIdFromQuery)
        ? sessionIdFromQuery
        : filteredSessions[0]?.id ?? null;

      selectedSession = filteredSessions.find((session) => session.id === selectedSessionId) ?? null;

      if (selectedSessionId && !loadError) {
        try {
          events = await getSessionEvents(client, selectedSessionId, tailLimit, { ascending: false });
          events.reverse();
        } catch (error) {
          loadError = formatError(error);
          events = [];
        }
      }

      const body = renderApp({
        configPath,
        projects,
        selectedProjectId,
        sessions,
        filteredSessions,
        selectedSessionId,
        selectedSession,
        events,
        projectKpis,
        projectTrend,
        tailLimit,
        refreshSeconds,
        sessionStatusFilter,
        actorFilter,
        loadError
      });
      sendHtml(res, 200, body);
    } catch (error) {
      const message = formatError(error);
      sendJson(res, 500, { error: message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  return { server, url: `http://${host}:${port}/` };
}
