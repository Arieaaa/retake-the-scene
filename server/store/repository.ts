import type { EpisodeId } from '../../shared/contracts';
import type { GameStore } from '../game/engine';

export interface VisitorRecord {
  tokenHash: string;
  expiresAt: number;
}

export interface RunRecord {
  id: string;
  ownerHash: string;
  createKey: string;
  episodeId: EpisodeId;
  expiresAt: number;
  version: number;
  stateVersion: 1;
  document: GameStore;
}

export interface GameRepository {
  createVisitor(visitor: VisitorRecord): Promise<void>;
  findVisitor(tokenHash: string): Promise<VisitorRecord | null>;
  findRun(ownerHash: string, runId: string): Promise<RunRecord | null>;
  findCreatedRun(ownerHash: string, createKey: string): Promise<RunRecord | null>;
  insertRun(run: RunRecord): Promise<boolean>;
  compareAndSetRun(run: RunRecord, expectedVersion: number): Promise<boolean>;
}
