import { createClient } from '@supabase/supabase-js';

const DEFAULT_RETRY_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 120;
const MAX_BACKOFF_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shouldRetry(error) {
  if (!error) {
    return false;
  }
  const status = Number(error.status ?? error.statusCode ?? 0);
  const code = String(error.code ?? '').toUpperCase();
  const message = String(error.message ?? '').toLowerCase();

  if (status >= 500 || status === 408 || status === 429) {
    return true;
  }
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') {
    return true;
  }
  if (message.includes('network') || message.includes('timeout') || message.includes('fetch failed')) {
    return true;
  }
  return false;
}

async function withRetry(taskName, fn, attempts = DEFAULT_RETRY_ATTEMPTS) {
  let attempt = 0;
  let lastError = null;
  while (attempt < attempts) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error)) {
        throw error;
      }
      const exponential = BASE_BACKOFF_MS * (2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * 80);
      const backoffMs = Math.min(MAX_BACKOFF_MS, exponential + jitter);
      await sleep(backoffMs);
    }
  }

  throw lastError ?? new Error(`${taskName} failed`);
}

export function getClient(config) {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error('Supabase is not configured. Run `opensession init` first.');
  }

  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false }
  });
}

export async function ensureProject(client, projectKey, projectName) {
  const { data: existing, error: lookupError } = await withRetry('ensureProject.lookup', () =>
    client
      .from('projects')
      .select('id,project_key,name')
      .eq('project_key', projectKey)
      .maybeSingle()
  );

  if (lookupError) {
    throw lookupError;
  }

  if (existing) {
    return existing;
  }

  const { data: created, error: insertError } = await withRetry('ensureProject.insert', () =>
    client
      .from('projects')
      .insert({ project_key: projectKey, name: projectName ?? projectKey })
      .select('id,project_key,name')
      .single()
  );

  if (insertError) {
    throw insertError;
  }

  return created;
}

export async function startSession(client, projectId, actor, options = {}) {
  const operationId = options.operationId ?? `start-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const { data: session, error: sessionError } = await withRetry('startSession.insert', () =>
    client
      .from('sessions')
      .insert({ project_id: projectId, actor, status: 'active', started_at: new Date().toISOString() })
      .select('id,project_id,actor,status,started_at')
      .single()
  );

  if (sessionError) {
    throw sessionError;
  }

  const { error: eventError } = await withRetry('startSession.appendStartedEvent', () =>
    client
      .from('session_events')
      .insert({
        session_id: session.id,
        type: 'started',
        payload: {
          actor,
          idempotencyKey: `${operationId}:started`
        }
      })
  );

  if (eventError) {
    throw eventError;
  }

  return session;
}

export async function appendEvent(client, sessionId, type, payload = {}, options = {}) {
  const idempotencyKey = options.idempotencyKey ?? null;
  if (idempotencyKey) {
    const { data: existing, error: findError } = await withRetry('appendEvent.findExisting', () =>
      client
        .from('session_events')
        .select('id,session_id,type,payload,created_at')
        .eq('session_id', sessionId)
        .eq('type', type)
        .eq('payload->>idempotencyKey', idempotencyKey)
        .limit(1)
        .maybeSingle()
    );

    if (findError) {
      throw findError;
    }
    if (existing) {
      return existing;
    }
  }

  const nextPayload = idempotencyKey ? { ...payload, idempotencyKey } : payload;
  const { data, error } = await withRetry('appendEvent.insert', () =>
    client
      .from('session_events')
      .insert({ session_id: sessionId, type, payload: nextPayload })
      .select('id,session_id,type,payload,created_at')
      .single()
  );

  if (error) {
    throw error;
  }

  return data;
}

export async function validateConnection(supabaseUrl, supabaseAnonKey) {
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false }
  });
  const { error } = await withRetry('validateConnection', () =>
    client.from('projects').select('id').limit(1)
  );
  if (error) {
    throw error;
  }
}

export async function getSession(client, sessionId) {
  const { data, error } = await withRetry('getSession', () =>
    client
      .from('sessions')
      .select('id,project_id,actor,status,started_at,ended_at')
      .eq('id', sessionId)
      .maybeSingle()
  );

  if (error) {
    throw error;
  }

  return data;
}

export async function listActiveSessions(client, projectId) {
  const { data, error } = await withRetry('listActiveSessions', () =>
    client
      .from('sessions')
      .select('id,project_id,actor,status,started_at,ended_at')
      .eq('project_id', projectId)
      .eq('status', 'active')
      .order('started_at', { ascending: false })
  );

  if (error) {
    throw error;
  }

  return data;
}

export async function getSessionEvents(client, sessionId, limit = 50, options = {}) {
  const ascending = options.ascending !== false;
  const { data, error } = await withRetry('getSessionEvents', () =>
    client
      .from('session_events')
      .select('id,session_id,type,payload,created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending })
      .limit(limit)
  );

  if (error) {
    throw error;
  }

  return data;
}

export async function listSessionEvents(client, sessionIds, options = {}) {
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
    return [];
  }

  let query = client
    .from('session_events')
    .select('id,session_id,type,payload,created_at')
    .in('session_id', sessionIds)
    .order('created_at', { ascending: options.ascending !== false });

  if (options.since) {
    query = query.gte('created_at', options.since);
  }
  if (options.until) {
    query = query.lt('created_at', options.until);
  }
  if (Number.isInteger(options.limit) && options.limit > 0) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  return data;
}

export async function listProjects(client, limit = 50) {
  const { data, error } = await withRetry('listProjects', () =>
    client
      .from('projects')
      .select('id,project_key,name,created_at')
      .order('created_at', { ascending: false })
      .limit(limit)
  );

  if (error) {
    throw error;
  }

  return data;
}

export async function listSessions(client, projectId, limit = 100) {
  const { data, error } = await withRetry('listSessions', () =>
    client
      .from('sessions')
      .select('id,project_id,actor,status,started_at,ended_at')
      .eq('project_id', projectId)
      .order('started_at', { ascending: false })
      .limit(limit)
  );

  if (error) {
    throw error;
  }

  return data;
}
