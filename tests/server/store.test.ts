import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameError, type PlayerView } from '../../shared/contracts';
import type { RunRecord, VisitorRecord } from '../../server/store/repository';
import { SqliteRepository } from '../../server/store/sqlite';
import { SitesRepository, type SitesDatabase, type SitesMutation, type SitesSelection, type SitesTable } from '../../server/store/sites';

const owner = createHash('sha256').update('test-only-visitor-token').digest('hex');
const otherOwner = createHash('sha256').update('test-only-other-token').digest('hex');
const expiresAt = 1_800_000_000_123;
const visitor: VisitorRecord = { tokenHash: owner, expiresAt };
const runColumns = 'id,owner_hash,create_key,episode_id,expires_at,version,state_version,document';

function makeRun(overrides: Partial<Pick<RunRecord, 'id' | 'ownerHash' | 'createKey'>> = {}): RunRecord {
  const { id = 'run-a', ownerHash = owner, createKey = 'create-a' } = overrides;
  const view: PlayerView = {
    runId: id, branchId: 'branch-a', episodeId: 'wedding', scriptVersion: '1.0.0', revision: 0,
    stage: 1, status: 'ready', scene: { title: 'Scene', kicker: '', text: '', prop: '' },
    choices: [], visibleEvents: [], inventory: [], checkpoints: [], branches: [], activeRequest: null,
    ending: null, presentation: { saved: true },
  };
  const receipt = { fingerprint: 'saved-command', result: view };
  return {
    id, ownerHash, createKey, episodeId: 'wedding', expiresAt, version: 0, stateVersion: 1,
    document: {
      runs: { [id]: {
        episodeId: 'wedding', scriptVersion: '1.0.0',
        branches: { 'branch-a': {
          parentBranchId: null, label: 'First', state: view,
          checkpoints: [{ checkpoint: { id: 'checkpoint-a', stage: 1, label: 'Opening' }, state: view }],
          requests: { 'turn-a': receipt },
        } },
        forkKeys: { 'fork-a': receipt },
      } },
      createKeys: { [JSON.stringify(createKey)]: receipt },
    },
  };
}
function nextRun(run: RunRecord, marker: string): RunRecord {
  const next = structuredClone(run);
  next.version = run.version + 1;
  next.expiresAt += 1000;
  next.document.runs[run.id].branches['branch-a'].state.presentation.winner = marker;
  next.document.runs[run.id].branches[`branch-${marker}`] = structuredClone(next.document.runs[run.id].branches['branch-a']);
  next.document.createKeys[marker] = structuredClone(Object.values(next.document.createKeys)[0]);
  return next;
}
function row(run: RunRecord): Record<string, unknown> {
  return {
    id: run.id, owner_hash: run.ownerHash, create_key: run.createKey, episode_id: run.episodeId,
    expires_at: run.expiresAt, version: run.version, state_version: run.stateVersion, document: run.document,
  };
}
function result(data: unknown): unknown { return { data, error: null }; }
async function expectUnavailable(promise: Promise<unknown>): Promise<void> {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(GameError);
  expect(error).toMatchObject({
    code: 'SERVICE_UNAVAILABLE', message: '存档服务暂时不可用，请沿用原请求重试。', retryable: true, status: 503,
  });
  expect(error).not.toHaveProperty('cause');
  expect(String(error)).not.toContain('provider-secret');
  expect(JSON.stringify(error)).not.toContain('provider-secret');
}

describe('SqliteRepository', () => {
  let directory: string;
  let filename: string;
  let first: SqliteRepository;
  let second: SqliteRepository;
  const connections: SqliteRepository[] = [];
  function connect(): SqliteRepository {
    const connection = new SqliteRepository(filename);
    connections.push(connection);
    return connection;
  }
  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'retake-store-'));
    filename = join(directory, 'game.sqlite');
    first = connect();
    second = connect();
    await first.createVisitor(visitor);
    await first.createVisitor({ tokenHash: otherOwner, expiresAt });
  });
  afterEach(() => {
    for (const connection of connections.splice(0)) connection.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('allows exactly one CAS from two independent connections and persists the whole winning document after reopen', async () => {
    const initial = makeRun();
    expect(await first.insertRun(initial)).toBe(true);
    const [left, right] = await Promise.all([first.findRun(owner, initial.id), second.findRun(owner, initial.id)]);
    expect(left).toEqual(initial);
    expect(right).toEqual(initial);
    const nextLeft = nextRun(left!, 'left');
    const nextRight = nextRun(right!, 'right');
    const writes = await Promise.all([
      first.compareAndSetRun(nextLeft, left!.version), second.compareAndSetRun(nextRight, right!.version),
    ]);
    expect(writes.filter(Boolean)).toHaveLength(1);
    const winner = writes[0] ? nextLeft : nextRight;
    expect(await second.findRun(owner, initial.id)).toEqual(winner);
    expect(await first.compareAndSetRun(nextRight, initial.version)).toBe(false);
    first.close();
    second.close();
    const reopened = connect();
    expect(await reopened.findRun(owner, initial.id)).toEqual(winner);
    expect(await reopened.findCreatedRun(owner, initial.createKey)).toEqual(winner);
    expect(await reopened.findVisitor(owner)).toEqual(visitor);
  });

  it('deduplicates creates only within the same owner without replacing the original row', async () => {
    const initial = makeRun();
    const duplicate = makeRun({ id: 'different-id' });
    expect(await first.insertRun(initial)).toBe(true);
    expect(await second.insertRun(duplicate)).toBe(false);
    expect(await second.insertRun(initial)).toBe(false);
    expect(await first.findCreatedRun(owner, initial.createKey)).toEqual(initial);
    expect(await first.findRun(owner, duplicate.id)).toBeNull();
    const other = makeRun({ id: 'other-run', ownerHash: otherOwner });
    expect(await second.insertRun(other)).toBe(true);
    expect(await first.findCreatedRun(otherOwner, initial.createKey)).toEqual(other);
    // A primary-key collision is not an idempotent-create hit.
    await expectUnavailable(first.insertRun(makeRun({ createKey: 'new-key' })));
  });

  it('scopes every lookup and conditional write by owner and binds untrusted values', async () => {
    const initial = makeRun({ createKey: "key'; DROP TABLE retake_runs; --" });
    await first.insertRun(initial);
    expect(await second.findRun(otherOwner, initial.id)).toBeNull();
    expect(await second.findCreatedRun(otherOwner, initial.createKey)).toBeNull();
    expect(await second.findVisitor("' OR 1=1 --")).toBeNull();
    expect(await second.findRun("' OR 1=1 --", initial.id)).toBeNull();
    expect(await second.findRun(owner, "' OR 1=1 --")).toBeNull();
    expect(await second.findCreatedRun(owner, "' OR 1=1 --")).toBeNull();
    expect(await second.findRun(owner, 'missing')).toBeNull();
    expect(await second.compareAndSetRun({ ...nextRun(initial, 'foreign'), ownerHash: otherOwner }, 0)).toBe(false);
    expect(await second.compareAndSetRun({ ...nextRun(initial, 'missing'), id: 'missing' }, 0)).toBe(false);
    expect(await second.compareAndSetRun(nextRun(initial, 'stale'), 99)).toBe(false);
    expect(await first.findRun(owner, initial.id)).toEqual(initial);
    expect(await first.findCreatedRun(owner, initial.createKey)).toEqual(initial);
  });

  it('stores only visitor digests/expiry and a single JSON string with indexed summaries', async () => {
    const extraVisitor = { ...visitor, token: 'test-only-visitor-token' };
    await first.createVisitor(extraVisitor);
    await first.createVisitor({ ...visitor, expiresAt: expiresAt + 1000 });
    const initial = makeRun();
    await first.insertRun(initial);
    const next = nextRun(initial, 'summary');
    expect(await first.compareAndSetRun(next, initial.version)).toBe(true);
    const inspection = new DatabaseSync(filename);
    try {
      expect(inspection.prepare('PRAGMA journal_mode').get()?.journal_mode).toBe('wal');
      expect(inspection.prepare('PRAGMA table_info(retake_visitors)').all().map(column => column.name))
        .toEqual(['token_hash', 'expires_at']);
      expect(inspection.prepare('SELECT * FROM retake_visitors WHERE token_hash = ?').get(owner))
        .toEqual({ token_hash: owner, expires_at: expiresAt });
      const stored = inspection.prepare('SELECT * FROM retake_runs').all();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toEqual({ ...row(next), document: JSON.stringify(next.document) });
      expect(JSON.parse(String(stored[0].document))).toEqual(next.document);
      expect(inspection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all())
        .toEqual([{ name: 'retake_runs' }, { name: 'retake_visitors' }]);
      expect(inspection.prepare('PRAGMA index_list(retake_runs)').all().some(index => index.unique === 1)).toBe(true);
    } finally {
      inspection.close();
    }
    await expectUnavailable(first.insertRun(makeRun({ ownerHash: 'missing-visitor' })));
    expect(await second.findVisitor('missing-visitor')).toBeNull();
  });

  it('does not create a missing parent directory or expose SQLite failures', async () => {
    const missing = join(directory, 'caller-must-create');
    expect(() => new SqliteRepository(join(missing, 'game.sqlite'))).toThrow(GameError);
    expect(existsSync(missing)).toBe(false);
    first.close();
    await expectUnavailable(first.findVisitor(owner));
  });
});

// A controlled thenable SDK fake records the exact query chain and returns queued results.
class ControlledSdk implements SitesDatabase {
  readonly calls: unknown[][] = [];
  executions = 0;
  constructor(private readonly outcomes: Array<() => unknown>) {}
  from(table: 'retake_visitors' | 'retake_runs'): ControlledQuery {
    this.calls.push(['from', table]);
    return new ControlledQuery(this);
  }
  complete(): unknown {
    this.executions += 1;
    const outcome = this.outcomes.shift();
    if (!outcome) throw new Error('Unexpected SDK execution');
    return outcome();
  }
}
class ControlledQuery implements SitesSelection, SitesMutation, SitesTable {
  constructor(private readonly sdk: ControlledSdk) {}
  select(columns: string): this { this.sdk.calls.push(['select', columns]); return this; }
  eq(column: string, value: string | number): this { this.sdk.calls.push(['eq', column, value]); return this; }
  limit(count: number): this { this.sdk.calls.push(['limit', count]); return this; }
  insertIfAbsent(value: Record<string, unknown>, options: { onConflict: string }): this {
    this.sdk.calls.push(['insertIfAbsent', value, options]); return this;
  }
  update(value: Record<string, unknown>): this { this.sdk.calls.push(['update', value]); return this; }
  then<T = unknown, E = never>(
    fulfilled?: ((value: unknown) => T | PromiseLike<T>) | null,
    rejected?: ((reason: unknown) => E | PromiseLike<E>) | null,
  ): Promise<T | E> {
    return Promise.resolve().then(() => this.sdk.complete()).then(fulfilled, rejected);
  }
}
function controlled(...results: unknown[]): ControlledSdk { return new ControlledSdk(results.map(value => () => value)); }

describe('SitesRepository', () => {
  it('scopes reads by owner and id/create key, limits to one row, and decodes summaries', async () => {
    const run = makeRun();
    const sdk = controlled(result([row(run)]), result([row(run)]));
    const repository = new SitesRepository(sdk);
    expect(await repository.findRun(owner, run.id)).toEqual(run);
    expect(await repository.findCreatedRun(owner, run.createKey)).toEqual(run);
    expect(sdk.calls).toEqual([
      ['from', 'retake_runs'], ['select', runColumns], ['eq', 'id', run.id], ['eq', 'owner_hash', owner], ['limit', 1],
      ['from', 'retake_runs'], ['select', runColumns], ['eq', 'owner_hash', owner], ['eq', 'create_key', run.createKey], ['limit', 1],
    ]);
  });

  it('inserts JSON objects using the owner/create conflict key and returns affected rows', async () => {
    const run = makeRun();
    const sdk = controlled(result([{ id: run.id }]), result([]));
    const repository = new SitesRepository(sdk);
    expect(await repository.insertRun(run)).toBe(true);
    expect(await repository.insertRun(run)).toBe(false);
    const expected = [
      ['from', 'retake_runs'], ['insertIfAbsent', row(run), { onConflict: 'owner_hash,create_key' }], ['select', 'id'],
    ];
    expect(sdk.calls).toEqual([...expected, ...expected]);
    expect(sdk.executions).toBe(2);
  });

  it('uses id/owner/version predicates on the write itself and uses the service-supplied next version', async () => {
    const run = nextRun(makeRun(), 'cas');
    const sdk = controlled(result([{ id: run.id }]), result([]));
    const repository = new SitesRepository(sdk);
    expect(await repository.compareAndSetRun(run, 0)).toBe(true);
    expect(await repository.compareAndSetRun(run, 0)).toBe(false);
    const expected = [
      ['from', 'retake_runs'], ['update', {
        episode_id: run.episodeId, expires_at: run.expiresAt, version: 1, state_version: 1, document: run.document,
      }], ['eq', 'id', run.id], ['eq', 'owner_hash', owner], ['eq', 'version', 0], ['select', 'id'],
    ];
    expect(sdk.calls).toEqual([...expected, ...expected]);
    expect(sdk.executions).toBe(2);
  });

  it('persists only visitor hashes and epoch expiry, including idempotent visitor creation', async () => {
    const sdk = controlled(result([{ token_hash: owner }]), result([]), result([{ token_hash: owner, expires_at: expiresAt }]));
    const repository = new SitesRepository(sdk);
    const extraVisitor = { ...visitor, token: 'test-only-visitor-token' };
    await repository.createVisitor(extraVisitor);
    await repository.createVisitor(visitor);
    expect(await repository.findVisitor(owner)).toEqual(visitor);
    const insert = [['from', 'retake_visitors'], ['insertIfAbsent', { token_hash: owner, expires_at: expiresAt },
      { onConflict: 'token_hash' }], ['select', 'token_hash']];
    expect(sdk.calls).toEqual([...insert, ...insert,
      ['from', 'retake_visitors'], ['select', 'token_hash,expires_at'], ['eq', 'token_hash', owner], ['limit', 1],
    ]);
  });

  it('returns null only for successful empty lookups', async () => {
    const repository = new SitesRepository(controlled(result([]), result([]), result([])));
    expect(await repository.findVisitor(owner)).toBeNull();
    expect(await repository.findRun(owner, 'missing')).toBeNull();
    expect(await repository.findCreatedRun(owner, 'missing')).toBeNull();
  });

  const operations: Array<[string, (repository: SitesRepository) => Promise<unknown>]> = [
    ['createVisitor', repository => repository.createVisitor(visitor)],
    ['findVisitor', repository => repository.findVisitor(owner)],
    ['findRun', repository => repository.findRun(owner, 'run-a')],
    ['findCreatedRun', repository => repository.findCreatedRun(owner, 'create-a')],
    ['insertRun', repository => repository.insertRun(makeRun())],
    ['compareAndSetRun', repository => repository.compareAndSetRun(nextRun(makeRun(), 'error'), 0)],
  ];
  it.each(operations)('%s maps provider failures to sanitized 503 without retrying', async (_name, operation) => {
    const failures: Array<() => unknown> = [
      () => ({ data: [], error: { code: 'provider-secret', status: 401, message: 'provider-secret' } }),
      () => { throw new Error('provider-secret'); },
      () => Promise.reject(new Error('provider-secret')),
    ];
    for (const failure of failures) {
      const sdk = new ControlledSdk([failure]);
      await expectUnavailable(operation(new SitesRepository(sdk)));
      expect(sdk.executions).toBe(1);
    }
    const broken: SitesDatabase = { from() { throw new Error('provider-secret'); } };
    await expectUnavailable(operation(new SitesRepository(broken)));
  });

  it.each([
    ['null result', null], ['missing result', undefined], ['null data', result(null)], ['object data', result({})],
    ['null row', result([null])], ['multiple rows', result([row(makeRun()), row(makeRun())])],
    ['error with data', { data: [row(makeRun())], error: 'provider-secret' }],
  ])('rejects malformed result: %s', async (_name, response) => {
    await expectUnavailable(new SitesRepository(controlled(response)).findRun(owner, 'run-a'));
  });

  it.each([
    ['id', null], ['id', 'wrong-id'], ['owner_hash', otherOwner], ['create_key', ''], ['episode_id', 'unknown'],
    ['expires_at', '1800000000123'], ['expires_at', -1], ['version', 0.5], ['version', Number.MAX_SAFE_INTEGER + 1],
    ['state_version', 2], ['document', null], ['document', '{}'], ['document', []], ['document', {}],
    ['document', { runs: [], createKeys: {} }], ['document', { runs: {}, createKeys: null }],
    ['document', { runs: {}, createKeys: {}, invalid: undefined }],
  ])('validates external run field %s (%j)', async (field, value) => {
    const response = result([{ ...row(makeRun()), [String(field)]: value }]);
    await expectUnavailable(new SitesRepository(controlled(response)).findRun(owner, 'run-a'));
  });

  it('rejects mismatched create keys and malformed visitor rows instead of treating them as absent', async () => {
    await expectUnavailable(new SitesRepository(controlled(result([row(makeRun())]))).findCreatedRun(owner, 'wrong-key'));
    for (const invalid of [{ token_hash: otherOwner, expires_at: expiresAt }, { token_hash: owner, expires_at: null },
      { token_hash: null, expires_at: expiresAt }, { token_hash: owner, expires_at: 1.5 }]) {
      await expectUnavailable(new SitesRepository(controlled(result([invalid]))).findVisitor(owner));
    }
  });

  it('validates mutation return rows; null, missing ids, wrong ids and multiple rows are never zero affected', async () => {
    for (const invalid of [null, [], {}, { id: null }, { id: 7 }, { id: 'wrong-id' }]) {
      const response = result([invalid]);
      await expectUnavailable(new SitesRepository(controlled(response)).insertRun(makeRun()));
      await expectUnavailable(new SitesRepository(controlled(response)).compareAndSetRun(nextRun(makeRun(), 'bad'), 0));
    }
    for (const response of [result(null), result([{ id: 'run-a' }, { id: 'run-a' }])]) {
      await expectUnavailable(new SitesRepository(controlled(response)).insertRun(makeRun()));
      await expectUnavailable(new SitesRepository(controlled(response)).compareAndSetRun(nextRun(makeRun(), 'bad'), 0));
    }
    await expectUnavailable(new SitesRepository(controlled(result([{}]))).createVisitor(visitor));
  });
});
