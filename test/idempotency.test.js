import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseResumeOperation, reserveResumeOperation } from '../src/idempotency.js';

test('reserveResumeOperation persists generated id for retry and restart safety', () => {
  const initial = {};
  const first = reserveResumeOperation(initial, 'session-1', 'alice');
  assert.equal(typeof first.operationId, 'string');
  assert.ok(first.operationId.length > 0);
  assert.equal(first.nextConfig.pendingResumeOperations['session-1:alice'], first.operationId);

  const afterRestart = reserveResumeOperation(first.nextConfig, 'session-1', 'alice');
  assert.equal(afterRestart.operationId, first.operationId);
  assert.equal(afterRestart.nextConfig, first.nextConfig);
});

test('releaseResumeOperation clears pending key and next reservation gets new id', () => {
  const reserved = reserveResumeOperation({}, 'session-2', 'bob');
  const cleared = releaseResumeOperation(reserved.nextConfig, 'session-2', 'bob');
  assert.equal(cleared.pendingResumeOperations['session-2:bob'], undefined);

  const next = reserveResumeOperation(cleared, 'session-2', 'bob');
  assert.notEqual(next.operationId, reserved.operationId);
});

test('explicit operation id is stored and reused as provided', () => {
  const reserved = reserveResumeOperation({}, 'session-3', 'carol', 'resume-op-123');
  assert.equal(reserved.operationId, 'resume-op-123');
  assert.equal(reserved.nextConfig.pendingResumeOperations['session-3:carol'], 'resume-op-123');
});
