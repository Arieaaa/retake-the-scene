import { GameError } from '../../shared/contracts';
import type { GameRepository, RunRecord, VisitorRecord } from './repository';

// Only the injected function_backend SDK surface used by this adapter.
export interface SitesSelection extends PromiseLike<unknown> {
  eq(column: string, value: string | number): SitesSelection;
  limit(count: number): SitesSelection;
}
export interface SitesMutation {
  eq(column: string, value: string | number): SitesMutation;
  select(columns: string): PromiseLike<unknown>;
}
export interface SitesTable {
  select(columns: string): SitesSelection;
  insertIfAbsent(value: Record<string, unknown>, options: { onConflict: string }): Pick<SitesMutation, 'select'>;
  update(value: Record<string, unknown>): SitesMutation;
}
export interface SitesDatabase {
  from(table: 'retake_visitors' | 'retake_runs'): SitesTable;
}

const columns = 'id,owner_hash,create_key,episode_id,expires_at,version,state_version,document';
const episodes = new Set<unknown>(['wedding', 'office', 'romance', 'hiss', 'reply']);
function unavailable(): GameError {
  return new GameError('SERVICE_UNAVAILABLE', '存档服务暂时不可用，请沿用原请求重试。', true, 503);
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function json(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(json);
  return object(value) && Object.values(value).every(json);
}
function document(value: unknown): value is RunRecord['document'] {
  // The engine owns the versioned state format; reject malformed JSON/envelopes here.
  return object(value) && object(value.runs) && object(value.createKeys) && json(value);
}
function rows(result: unknown): Record<string, unknown>[] {
  if (!object(result) || (result.error !== null && result.error !== undefined)
    || !Array.isArray(result.data) || result.data.length > 1 || !result.data.every(object)) throw unavailable();
  return result.data;
}
function affected(result: unknown, column: 'id' | 'token_hash', expected: string): boolean {
  const found = rows(result);
  if (!found.length) return false;
  if (!text(found[0][column]) || found[0][column] !== expected) throw unavailable();
  return true;
}
function decodeRun(row: Record<string, unknown>): RunRecord {
  if (!text(row.id) || !text(row.owner_hash) || !text(row.create_key) || !episodes.has(row.episode_id)
    || !integer(row.expires_at) || !integer(row.version) || row.state_version !== 1 || !document(row.document)) throw unavailable();
  return {
    id: row.id,
    ownerHash: row.owner_hash,
    createKey: row.create_key,
    episodeId: row.episode_id as RunRecord['episodeId'],
    expiresAt: row.expires_at,
    version: row.version,
    stateVersion: 1,
    document: row.document,
  };
}
function runValues(run: RunRecord): Record<string, unknown> {
  return {
    episode_id: run.episodeId, expires_at: run.expiresAt, version: run.version,
    state_version: run.stateVersion, document: run.document,
  };
}

export class SitesRepository implements GameRepository {
  constructor(private readonly db: SitesDatabase) {}

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      // Provider errors may contain private data. Never expose or retry them here.
      throw unavailable();
    }
  }

  async createVisitor(visitor: VisitorRecord): Promise<void> {
    return this.execute(async () => {
      affected(await this.db.from('retake_visitors').insertIfAbsent({
        token_hash: visitor.tokenHash, expires_at: visitor.expiresAt,
      }, { onConflict: 'token_hash' }).select('token_hash'), 'token_hash', visitor.tokenHash);
    });
  }

  async findVisitor(tokenHash: string): Promise<VisitorRecord | null> {
    return this.execute(async () => {
      const [row] = rows(await this.db.from('retake_visitors').select('token_hash,expires_at')
        .eq('token_hash', tokenHash).limit(1));
      if (!row) return null;
      if (!text(row.token_hash) || row.token_hash !== tokenHash || !integer(row.expires_at)) throw unavailable();
      return { tokenHash: row.token_hash, expiresAt: row.expires_at };
    });
  }

  async findRun(ownerHash: string, runId: string): Promise<RunRecord | null> {
    return this.execute(async () => {
      const [row] = rows(await this.db.from('retake_runs').select(columns)
        .eq('id', runId).eq('owner_hash', ownerHash).limit(1));
      if (!row) return null;
      const run = decodeRun(row);
      if (run.id !== runId || run.ownerHash !== ownerHash) throw unavailable();
      return run;
    });
  }

  async findCreatedRun(ownerHash: string, createKey: string): Promise<RunRecord | null> {
    return this.execute(async () => {
      const [row] = rows(await this.db.from('retake_runs').select(columns)
        .eq('owner_hash', ownerHash).eq('create_key', createKey).limit(1));
      if (!row) return null;
      const run = decodeRun(row);
      if (run.ownerHash !== ownerHash || run.createKey !== createKey) throw unavailable();
      return run;
    });
  }

  async insertRun(run: RunRecord): Promise<boolean> {
    return this.execute(async () => affected(await this.db.from('retake_runs').insertIfAbsent({
      id: run.id, owner_hash: run.ownerHash, create_key: run.createKey, ...runValues(run),
    }, { onConflict: 'owner_hash,create_key' }).select('id'), 'id', run.id));
  }

  async compareAndSetRun(run: RunRecord, expectedVersion: number): Promise<boolean> {
    return this.execute(async () => affected(await this.db.from('retake_runs').update(runValues(run))
      .eq('id', run.id).eq('owner_hash', run.ownerHash).eq('version', expectedVersion).select('id'), 'id', run.id));
  }
}
