import http from 'node:http';
import { dispatchAutomation } from './automation.js';
import { appendEvent, ensureProject, getSession, listActiveSessions, startSession } from './supabase.js';

const MAX_BODY_BYTES = 1024 * 1024;

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

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Request body too large (max 1MB).'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });

    req.on('error', (error) => {
      reject(error);
    });
  });
}

async function resolveSession({ client, projectKey, actor, requestedSessionId, autoStartSession }) {
  const project = await ensureProject(client, projectKey, projectKey);

  if (requestedSessionId) {
    const existing = await getSession(client, requestedSessionId);
    if (!existing) {
      throw new Error(`Session not found: ${requestedSessionId}`);
    }
    return { project, session: existing, created: false };
  }

  const active = await listActiveSessions(client, project.id);
  if (active.length > 0) {
    return { project, session: active[0], created: false };
  }

  if (!autoStartSession) {
    throw new Error('No active session found and autoStartSession is disabled.');
  }

  const created = await startSession(client, project.id, actor);
  return { project, session: created, created: true };
}

export async function startHookServer({
  host,
  port,
  secret,
  projectKey,
  actor,
  autoStartSession,
  fixedSessionId,
  client,
  automationConfig
}) {
  const sharedSecret = typeof secret === 'string' && secret.length > 0 ? secret : null;

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method !== 'POST' || req.url !== '/webhooks/event') {
        sendJson(res, 404, { error: 'Not found' });
        return;
      }

      if (sharedSecret) {
        const provided = String(req.headers['x-opensession-secret'] ?? '');
        if (provided !== sharedSecret) {
          sendJson(res, 401, { error: 'Invalid secret' });
          return;
        }
      }

      const body = await readRequestBody(req);
      const incomingProjectKey = typeof body.projectKey === 'string' && body.projectKey.trim().length > 0
        ? body.projectKey.trim()
        : projectKey;

      if (!incomingProjectKey) {
        sendJson(res, 400, { error: 'Missing project key. Provide body.projectKey or --project-key.' });
        return;
      }

      const incomingActor = typeof body.actor === 'string' && body.actor.trim().length > 0
        ? body.actor.trim()
        : actor;
      const source = typeof body.source === 'string' && body.source.trim().length > 0 ? body.source.trim() : 'custom';
      const eventType = typeof body.eventType === 'string' && body.eventType.trim().length > 0
        ? body.eventType.trim()
        : `${source}.event`;

      const { project, session, created } = await resolveSession({
        client,
        projectKey: incomingProjectKey,
        actor: incomingActor,
        requestedSessionId: body.sessionId ?? fixedSessionId,
        autoStartSession
      });

      const payload = {
        source,
        receivedAt: new Date().toISOString(),
        data: body.payload ?? body
      };

      const event = await appendEvent(client, session.id, eventType, payload);
      const envelope = {
        projectId: project.id,
        projectKey: incomingProjectKey,
        sessionId: session.id,
        eventId: event.id,
        eventType,
        source,
        actor: incomingActor,
        createdSession: created,
        payload
      };

      const automationResults = await dispatchAutomation(envelope, automationConfig);
      sendJson(res, 202, {
        ok: true,
        projectKey: incomingProjectKey,
        sessionId: session.id,
        eventId: event.id,
        eventType,
        automationResults
      });
    } catch (error) {
      sendJson(res, 500, { error: formatError(error) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  return { server, url: `http://${host}:${port}` };
}
