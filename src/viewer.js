import http from 'node:http';
import { URL } from 'node:url';
import { getConfigPath, readConfig } from './config.js';
import { computeKpis, computeWeeklyTrend } from './metrics.js';
import { getClient, getSessionEvents, listProjects, listSessionEvents, listSessions } from './supabase.js';

const CSS = `
body { margin: 0; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f8fb; color: #111827; }
header { padding: 16px 20px; background: #111827; color: #f9fafb; }
header h1 { margin: 0; font-size: 18px; }
header p { margin: 6px 0 0; font-size: 13px; color: #d1d5db; }
main { display: grid; grid-template-columns: 280px 320px 1fr; gap: 12px; padding: 12px; }
section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
section h2 { margin: 0; padding: 10px 12px; font-size: 14px; border-bottom: 1px solid #e5e7eb; background: #f9fafb; }
ul { list-style: none; margin: 0; padding: 0; }
li { border-bottom: 1px solid #f1f5f9; }
li:last-child { border-bottom: 0; }
a.item { display: block; padding: 10px 12px; color: inherit; text-decoration: none; }
a.item:hover { background: #f3f4f6; }
a.item.active { background: #e5edff; }
.meta { display: block; margin-top: 4px; font-size: 12px; color: #6b7280; }
.panel-empty { padding: 12px; color: #6b7280; font-size: 13px; }
.content-col { display: grid; grid-template-rows: auto auto 1fr; gap: 12px; min-height: calc(100vh - 120px); }
.summary-grid { display: grid; grid-template-columns: repeat(2, minmax(140px, 1fr)); gap: 8px; padding: 10px 12px; }
.summary-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 10px; background: #f8fafc; }
.summary-card .label { display: block; font-size: 11px; color: #6b7280; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
.summary-card .value { font-size: 16px; font-weight: 600; }
.details { padding: 10px 12px; font-size: 13px; }
.details-row { display: grid; grid-template-columns: 120px 1fr; gap: 8px; padding: 4px 0; border-bottom: 1px solid #f1f5f9; }
.details-row:last-child { border-bottom: 0; }
.details-key { color: #6b7280; }
.events-header { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
.events-meta { font-size: 12px; color: #6b7280; padding-right: 12px; }
.trend-table td, .trend-table th { font-size: 12px; }
.controls { padding: 10px 12px; display: grid; gap: 8px; }
.controls-grid { display: grid; grid-template-columns: repeat(2, minmax(140px, 1fr)); gap: 8px; }
.controls label { display: grid; gap: 4px; font-size: 12px; color: #374151; }
.controls input, .controls select { height: 32px; border: 1px solid #d1d5db; border-radius: 6px; padding: 0 8px; font-size: 13px; }
.controls-actions { display: flex; gap: 8px; }
.controls .button { display: inline-flex; align-items: center; justify-content: center; border: 1px solid #111827; color: #f9fafb; background: #111827; border-radius: 6px; font-size: 12px; height: 30px; padding: 0 10px; text-decoration: none; }
.controls .button.secondary { color: #111827; background: #fff; border-color: #d1d5db; }
.mini-list { margin: 0; padding: 0; list-style: none; }
.mini-list li { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
.mini-list li:last-child { border-bottom: 0; }
.mini-list code { font-size: 11px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
th { background: #f9fafb; position: sticky; top: 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
@media (max-width: 1080px) {
  main { grid-template-columns: 1fr; }
  .content-col { min-height: auto; }
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
