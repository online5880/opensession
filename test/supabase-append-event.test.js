import test from 'node:test';
import assert from 'node:assert/strict';
import { appendEvent } from '../src/supabase.js';

function createMockClient({ insertResponses, existingResponses }) {
  const state = {
    inserts: [],
    selects: []
  };

  const takeInsert = () => insertResponses.shift() ?? { data: null, error: new Error('missing insert response') };
  const takeExisting = () => existingResponses.shift() ?? { data: null, error: null };

  const client = {
    from(table) {
      return {
        insert(payload) {
          state.inserts.push({ table, payload });
          return {
            select() {
              return {
                async single() {
                  return takeInsert();
                }
              };
            }
          };
        },
        select(columns) {
          const record = { table, columns, filters: [], limit: null };
          state.selects.push(record);
          const query = {
            eq(column, value) {
              record.filters.push({ column, value });
              return query;
            },
            limit(value) {
              record.limit = value;
              return query;
            },
            async maybeSingle() {
              return takeExisting();
            }
          };
          return query;
        }
      };
    }
  };

  return { client, state };
}

test('appendEvent writes idempotency_key with payload idempotencyKey', async () => {
  const inserted = {
    id: 'event-1',
    session_id: 'session-1',
    type: 'resumed',
    payload: { actor: 'alice', idempotencyKey: 'resume-op-1' },
    created_at: '2026-03-13T00:00:00.000Z'
  };
  const mock = createMockClient({
    insertResponses: [{ data: inserted, error: null }],
    existingResponses: []
  });

  const event = await appendEvent(
    mock.client,
    'session-1',
    'resumed',
    { actor: 'alice' },
    { idempotencyKey: 'resume-op-1' }
  );

  assert.equal(event.id, 'event-1');
  assert.equal(mock.state.inserts.length, 1);
  assert.equal(mock.state.inserts[0].payload.idempotency_key, 'resume-op-1');
  assert.equal(mock.state.inserts[0].payload.payload.idempotencyKey, 'resume-op-1');
});

test('appendEvent returns existing row after unique violation conflict', async () => {
  const conflictError = { code: '23505', message: 'duplicate key value violates unique constraint' };
  const existing = {
    id: 'event-2',
    session_id: 'session-2',
    type: 'resumed',
    payload: { actor: 'bob', idempotencyKey: 'resume-op-2' },
    created_at: '2026-03-13T00:01:00.000Z'
  };
  const mock = createMockClient({
    insertResponses: [{ data: null, error: conflictError }],
    existingResponses: [{ data: existing, error: null }]
  });

  const event = await appendEvent(
    mock.client,
    'session-2',
    'resumed',
    { actor: 'bob' },
    { idempotencyKey: 'resume-op-2' }
  );

  assert.equal(event.id, 'event-2');
  assert.equal(mock.state.selects.length, 1);
  assert.deepEqual(
    mock.state.selects[0].filters,
    [
      { column: 'session_id', value: 'session-2' },
      { column: 'type', value: 'resumed' },
      { column: 'idempotency_key', value: 'resume-op-2' }
    ]
  );
});

test('appendEvent throws original conflict when existing row cannot be loaded', async () => {
  const conflictError = { code: '23505', message: 'duplicate key value violates unique constraint' };
  const mock = createMockClient({
    insertResponses: [{ data: null, error: conflictError }],
    existingResponses: [{ data: null, error: null }]
  });

  await assert.rejects(
    () =>
      appendEvent(
        mock.client,
        'session-3',
        'resumed',
        { actor: 'carol' },
        { idempotencyKey: 'resume-op-3' }
      ),
    (error) => error === conflictError
  );
});
