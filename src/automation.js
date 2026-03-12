const DEFAULT_TIMEOUT_MS = 5000;

function withTimeout(ms) {
  return AbortSignal.timeout(Number.isInteger(ms) && ms > 0 ? ms : DEFAULT_TIMEOUT_MS);
}

function normalizeArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value;
}

function normalizeHeaders(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const output = {};
  for (const [key, headerValue] of Object.entries(value)) {
    if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
      output[key] = headerValue;
    }
  }
  return output;
}

function normalizeWebhookTarget(target) {
  if (!target || typeof target !== 'object') {
    return null;
  }

  const url = typeof target.url === 'string' ? target.url.trim() : '';
  if (!url) {
    return null;
  }

  const eventTypes = normalizeArray(target.eventTypes).filter((item) => typeof item === 'string' && item.trim().length > 0);
  const source = typeof target.source === 'string' && target.source.trim().length > 0 ? target.source.trim() : null;

  return {
    type: 'webhook',
    url,
    eventTypes,
    source,
    headers: normalizeHeaders(target.headers),
    timeoutMs: Number.isInteger(target.timeoutMs) && target.timeoutMs > 0 ? target.timeoutMs : DEFAULT_TIMEOUT_MS
  };
}

function normalizeRule(rule) {
  if (!rule || typeof rule !== 'object') {
    return null;
  }

  const name = typeof rule.name === 'string' && rule.name.trim().length > 0 ? rule.name.trim() : 'unnamed-rule';
  const when = rule.when && typeof rule.when === 'object' && !Array.isArray(rule.when) ? rule.when : {};
  const actions = normalizeArray(rule.actions)
    .map((action) => normalizeWebhookTarget(action))
    .filter(Boolean);

  if (actions.length === 0) {
    return null;
  }

  return {
    name,
    when: {
      eventType: typeof when.eventType === 'string' ? when.eventType.trim() : null,
      source: typeof when.source === 'string' ? when.source.trim() : null,
      projectKey: typeof when.projectKey === 'string' ? when.projectKey.trim() : null
    },
    actions
  };
}

function shouldApplyTarget(target, envelope) {
  if (!target) {
    return false;
  }

  if (target.source && target.source !== envelope.source) {
    return false;
  }

  if (target.eventTypes.length > 0 && !target.eventTypes.includes(envelope.eventType)) {
    return false;
  }

  return true;
}

function ruleMatches(rule, envelope) {
  const { when } = rule;

  if (when.eventType && when.eventType !== envelope.eventType) {
    return false;
  }

  if (when.source && when.source !== envelope.source) {
    return false;
  }

  if (when.projectKey && when.projectKey !== envelope.projectKey) {
    return false;
  }

  return true;
}

async function postJson(url, body, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers ?? {})
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: withTimeout(options.timeoutMs)
  });

  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body: text.slice(0, 400)
  };
}

export async function dispatchAutomation(envelope, automationConfig = {}) {
  const rules = normalizeArray(automationConfig.rules)
    .map((rule) => normalizeRule(rule))
    .filter(Boolean);
  const directTargets = normalizeArray(automationConfig.webhooks)
    .map((target) => normalizeWebhookTarget(target))
    .filter(Boolean)
    .filter((target) => shouldApplyTarget(target, envelope));

  const results = [];

  for (const target of directTargets) {
    try {
      const response = await postJson(target.url, envelope, target);
      results.push({
        channel: 'webhook',
        mode: 'direct',
        destination: target.url,
        ...response
      });
    } catch (error) {
      results.push({
        channel: 'webhook',
        mode: 'direct',
        destination: target.url,
        ok: false,
        status: 0,
        body: error instanceof Error ? error.message : String(error)
      });
    }
  }

  for (const rule of rules) {
    if (!ruleMatches(rule, envelope)) {
      continue;
    }

    for (const action of rule.actions) {
      try {
        const response = await postJson(action.url, {
          rule: rule.name,
          event: envelope
        }, action);
        results.push({
          channel: 'webhook',
          mode: 'rule',
          rule: rule.name,
          destination: action.url,
          ...response
        });
      } catch (error) {
        results.push({
          channel: 'webhook',
          mode: 'rule',
          rule: rule.name,
          destination: action.url,
          ok: false,
          status: 0,
          body: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  return results;
}
