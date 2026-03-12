function toTimestamp(value) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    return null;
  }
  return time;
}

export function startOfUtcWeek(dateLike) {
  const date = new Date(dateLike);
  const day = date.getUTCDay();
  const daysFromMonday = (day + 6) % 7;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - daysFromMonday);
  return start;
}

export function addDaysUtc(dateLike, days) {
  const date = new Date(dateLike);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export function computeKpis(sessions, events) {
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const safeEvents = Array.isArray(events) ? events : [];
  const uniqueActors = new Set();

  for (const session of safeSessions) {
    if (session?.actor) {
      uniqueActors.add(session.actor);
    }
  }

  const resumedEvents = safeEvents.filter((event) => event?.type === 'resumed').length;
  const totalSessions = safeSessions.length;
  const totalEvents = safeEvents.length;

  return {
    totalSessions,
    activeSessions: safeSessions.filter((session) => session?.status === 'active').length,
    uniqueActors: uniqueActors.size,
    totalEvents,
    resumedEvents,
    eventsPerSession: totalSessions === 0 ? 0 : totalEvents / totalSessions,
    resumeRate: totalSessions === 0 ? 0 : resumedEvents / totalSessions
  };
}

export function computeWeeklyTrend(sessions, events, weekCount = 6, now = new Date()) {
  const safeWeekCount = Math.max(1, Math.min(26, Number.parseInt(String(weekCount), 10) || 6));
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const safeEvents = Array.isArray(events) ? events : [];
  const currentWeekStart = startOfUtcWeek(now);
  const firstWeekStart = addDaysUtc(currentWeekStart, (safeWeekCount - 1) * -7);

  const buckets = [];
  for (let i = 0; i < safeWeekCount; i += 1) {
    const start = addDaysUtc(firstWeekStart, i * 7);
    const end = addDaysUtc(start, 7);
    buckets.push({
      start,
      end,
      label: start.toISOString().slice(0, 10),
      sessions: 0,
      events: 0,
      actors: new Set()
    });
  }

  for (const session of safeSessions) {
    const ts = toTimestamp(session?.started_at);
    if (ts === null) {
      continue;
    }
    const index = Math.floor((ts - firstWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
    if (index < 0 || index >= buckets.length) {
      continue;
    }
    buckets[index].sessions += 1;
    if (session?.actor) {
      buckets[index].actors.add(session.actor);
    }
  }

  for (const event of safeEvents) {
    const ts = toTimestamp(event?.created_at);
    if (ts === null) {
      continue;
    }
    const index = Math.floor((ts - firstWeekStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
    if (index < 0 || index >= buckets.length) {
      continue;
    }
    buckets[index].events += 1;
  }

  return buckets.map((bucket) => ({
    weekStart: bucket.label,
    sessions: bucket.sessions,
    uniqueActors: bucket.actors.size,
    events: bucket.events
  }));
}

export function formatSignedDelta(current, previous) {
  const delta = current - previous;
  const prefix = delta > 0 ? '+' : '';
  return `${prefix}${delta}`;
}
