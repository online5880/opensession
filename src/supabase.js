import { createClient } from '@supabase/supabase-js';

export function getClient(config) {
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error('Supabase is not configured. Run `opensession init --url <url> --anon-key <key>`.');
  }

  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false }
  });
}

export async function ensureProject(client, projectKey, projectName) {
  const { data: existing, error: lookupError } = await client
    .from('projects')
    .select('id,project_key,name')
    .eq('project_key', projectKey)
    .maybeSingle();

  if (lookupError) {
    throw lookupError;
  }

  if (existing) {
    return existing;
  }

  const { data: created, error: insertError } = await client
    .from('projects')
    .insert({ project_key: projectKey, name: projectName ?? projectKey })
    .select('id,project_key,name')
    .single();

  if (insertError) {
    throw insertError;
  }

  return created;
}

export async function startSession(client, projectId, actor) {
  const { data: session, error: sessionError } = await client
    .from('sessions')
    .insert({ project_id: projectId, actor, status: 'active', started_at: new Date().toISOString() })
    .select('id,project_id,actor,status,started_at')
    .single();

  if (sessionError) {
    throw sessionError;
  }

  const { error: eventError } = await client
    .from('session_events')
    .insert({ session_id: session.id, type: 'started', payload: { actor } });

  if (eventError) {
    throw eventError;
  }

  return session;
}

export async function appendEvent(client, sessionId, type, payload = {}) {
  const { data, error } = await client
    .from('session_events')
    .insert({ session_id: sessionId, type, payload })
    .select('id,session_id,type,payload,created_at')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function getSession(client, sessionId) {
  const { data, error } = await client
    .from('sessions')
    .select('id,project_id,actor,status,started_at,ended_at')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

export async function listActiveSessions(client, projectId) {
  const { data, error } = await client
    .from('sessions')
    .select('id,project_id,actor,status,started_at,ended_at')
    .eq('project_id', projectId)
    .eq('status', 'active')
    .order('started_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data;
}

export async function getSessionEvents(client, sessionId, limit = 50) {
  const { data, error } = await client
    .from('session_events')
    .select('id,session_id,type,payload,created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw error;
  }

  return data;
}
