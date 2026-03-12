import { randomUUID } from 'node:crypto';

function getPendingResumeMap(config) {
  const value = config?.pendingResumeOperations;
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value;
}

function getResumeSlot(sessionId, actor) {
  return `${sessionId}:${actor}`;
}

export function reserveResumeOperation(config, sessionId, actor, requestedOperationId = null) {
  const trimmedRequested = typeof requestedOperationId === 'string' && requestedOperationId.trim().length > 0
    ? requestedOperationId.trim()
    : null;
  const slot = getResumeSlot(sessionId, actor);
  const pending = getPendingResumeMap(config);

  if (trimmedRequested) {
    return {
      operationId: trimmedRequested,
      nextConfig: {
        ...config,
        pendingResumeOperations: {
          ...pending,
          [slot]: trimmedRequested
        }
      }
    };
  }

  const existing = pending[slot];
  if (typeof existing === 'string' && existing.trim().length > 0) {
    return { operationId: existing, nextConfig: config };
  }

  const generated = randomUUID();
  return {
    operationId: generated,
    nextConfig: {
      ...config,
      pendingResumeOperations: {
        ...pending,
        [slot]: generated
      }
    }
  };
}

export function releaseResumeOperation(config, sessionId, actor) {
  const slot = getResumeSlot(sessionId, actor);
  const pending = getPendingResumeMap(config);
  if (!(slot in pending)) {
    return config;
  }

  const nextPending = { ...pending };
  delete nextPending[slot];
  return {
    ...config,
    pendingResumeOperations: nextPending
  };
}
