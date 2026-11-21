import { DatabaseSync } from 'node:sqlite';
import { GameError } from '../../shared/contracts';
import type { GameRepository, RunRecord, VisitorRecord } from './repository';

const columns = 'id, owner_hash, create_key, episode_id, expires_at, version, state_version, document';
const schema = `
  CREATE TABLE IF NOT EXISTS retake_visitors (
    token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) > 0),
    expires_at INTEGER NOT NULL CHECK (expires_at BETWEEN 0 AND 9007199254740991)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS retake_runs (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    owner_hash TEXT NOT NULL REFERENCES retake_visitors(token_hash) ON DELETE CASCADE,
    create_key TEXT NOT NULL CHECK (length(create_key) > 0),
    episode_id TEXT NOT NULL CHECK (episode_id IN ('wedding', 'office', 'romance', 'hiss', 'reply')),
    expires_at INTEGER NOT NULL CHECK (expires_at BETWEEN 0 AND 9007199254740991),
    version INTEGER NOT NULL CHECK (version BETWEEN 0 AND 9007199254740991),
    state_version INTEGER NOT NULL CHECK (state_version = 1),
    document TEXT NOT NULL CHECK (json_valid(document) AND json_type(document) = 'object'),
    UNIQUE (owner_hash, create_key)
  ) STRICT;
  CREATE INDEX IF NOT EXISTS retake_visitors_expires_at_idx ON retake_visitors(expires_at);
  CREATE INDEX IF NOT EXISTS retake_runs_expires_at_idx ON retake_runs(expires_at);
`;

function unavailable(): GameError {
  return new GameError('SERVICE_UNAVAILABLE', '存档服务暂时不可用，请沿用原请求重试。', true, 503);
}

function decodeRun(row: Record<string, unknown> | undefined): RunRecord | null {
  if (!row) return null;
  const document: unknown = JSON.parse(String(row.document));
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw unavailable();
  return {
    id: row.id as string,
    ownerHash: row.owner_hash as string,
    createKey: row.create_key as string,
    episodeId: row.episode_id as RunRecord['episodeId'],
    expiresAt: row.expires_at as number,
    version: row.version as number,
    stateVersion: row.state_version as 1,
    document: document as RunRecord['document'],
  };
}

export class SqliteRepository implements GameRepository {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(filename: string) {
    // The caller owns directory creation. Never fall back to an in-memory database.
    try {
      this.db = new DatabaseSync(filename);
    } catch {
      throw unavailable();
    }
    try {
      this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
      this.db.exec(schema);
    } catch {
      this.db.close();
      throw unavailable();
    }
  }

  close(): void {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }

  private execute<T>(operation: () => T): T {
    try {
      return operation();
    } catch {
      // Do not retry an operation whose commit outcome is unknown.
      throw unavailable();
    }
  }

  async createVisitor(visitor: VisitorRecord): Promise<void> {
    this.execute(() => {
      this.db.prepare(`INSERT INTO retake_visitors (token_hash, expires_at) VALUES (?, ?)
        ON CONFLICT(token_hash) DO NOTHING`).run(visitor.tokenHash, visitor.expiresAt);
    });
  }

  async findVisitor(tokenHash: string): Promise<VisitorRecord | null> {
    return this.execute(() => {
      const row = this.db.prepare('SELECT token_hash, expires_at FROM retake_visitors WHERE token_hash = ?').get(tokenHash);
      return row ? { tokenHash: row.token_hash as string, expiresAt: row.expires_at as number } : null;
    });
  }

  async findRun(ownerHash: string, runId: string): Promise<RunRecord | null> {
    return this.execute(() => decodeRun(this.db.prepare(
      `SELECT ${columns} FROM retake_runs WHERE id = ? AND owner_hash = ?`,
    ).get(runId, ownerHash)));
  }

  async findCreatedRun(ownerHash: string, createKey: string): Promise<RunRecord | null> {
    return this.execute(() => decodeRun(this.db.prepare(
      `SELECT ${columns} FROM retake_runs WHERE owner_hash = ? AND create_key = ?`,
    ).get(ownerHash, createKey)));
  }

  async insertRun(run: RunRecord): Promise<boolean> {
    return this.execute(() => this.db.prepare(`INSERT INTO retake_runs (${columns})
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_hash, create_key) DO NOTHING`).run(
      run.id, run.ownerHash, run.createKey, run.episodeId, run.expiresAt, run.version,
      run.stateVersion, JSON.stringify(run.document),
    ).changes === 1);
  }

  async compareAndSetRun(run: RunRecord, expectedVersion: number): Promise<boolean> {
    return this.execute(() => this.db.prepare(`UPDATE retake_runs
      SET episode_id = ?, expires_at = ?, version = ?, state_version = ?, document = ?
      WHERE id = ? AND owner_hash = ? AND version = ?`).run(
      run.episodeId, run.expiresAt, run.version, run.stateVersion, JSON.stringify(run.document),
      run.id, run.ownerHash, expectedVersion,
    ).changes === 1);
  }
}
