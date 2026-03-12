import http from 'node:http';
import { URL } from 'node:url';
import { getConfigPath, readConfig } from './config.js';
import { getClient, getSessionEvents, listProjects, listSessions } from './supabase.js';

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

function renderApp({
  configPath,
  projects,
  selectedProjectId,
  sessions,
  selectedSessionId,
  selectedSession,
  events,
  tailLimit,
  refreshSeconds,
  loadError
}) {
  const projectItems = projects
    .map((project) => {
      const active = project.id === selectedProjectId ? ' active' : '';
      const href = `/?projectId=${encodeURIComponent(project.id)}`;
      return `<li><a class="item${active}" href="${href}"><strong>${escapeHtml(project.project_key)}</strong><span class="meta">${escapeHtml(project.name)}</span></a></li>`;
    })
    .join('');

  const sessionItems = sessions
    .map((session) => {
      const active = session.id === selectedSessionId ? ' active' : '';
      const href = `/?projectId=${encodeURIComponent(selectedProjectId)}&sessionId=${encodeURIComponent(session.id)}`;
      return `<li><a class="item${active}" href="${href}"><strong>${escapeHtml(session.actor)}</strong><span class="meta">${escapeHtml(session.id)} | ${escapeHtml(session.status)} | ${escapeHtml(session.started_at)}</span></a></li>`;
    })
    .join('');

  const activeSessions = sessions.filter((session) => session.status === 'active').length;
  const latestEventAt = events.length > 0 ? events[events.length - 1].created_at : '-';
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
        <h2>Sessions (${sessions.length})</h2>
        ${sessions.length === 0 ? '<div class="panel-empty">Select a project to view sessions.</div>' : `<ul>${sessionItems}</ul>`}
      </section>
      <div class="content-col">
        <section>
          <h2>Usage Summary</h2>
          <div class="summary-grid">
            <div class="summary-card"><span class="label">Projects</span><span class="value">${projects.length}</span></div>
            <div class="summary-card"><span class="label">Project Sessions</span><span class="value">${sessions.length}</span></div>
            <div class="summary-card"><span class="label">Active Sessions</span><span class="value">${activeSessions}</span></div>
            <div class="summary-card"><span class="label">Tail Events</span><span class="value">${events.length}</span></div>
          </div>
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
        } catch (error) {
          loadError = formatError(error);
          sessions = [];
        }
      }
      const sessionIdFromQuery = url.searchParams.get('sessionId');
      const selectedSessionId = sessions.some((item) => item.id === sessionIdFromQuery)
        ? sessionIdFromQuery
        : sessions[0]?.id ?? null;

      selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;
      const tailLimit = toIntegerInRange(url.searchParams.get('tail'), 200, 1, 500);
      const refreshSeconds = toIntegerInRange(url.searchParams.get('refresh'), 0, 0, 60);

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
        selectedSessionId,
        selectedSession,
        events,
        tailLimit,
        refreshSeconds,
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
