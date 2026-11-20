export const CONTRACT_VERSION = '1.1';
export const SCRIPT_VERSION = '1.0.0';
export type EpisodeId = 'wedding' | 'office' | 'romance' | 'hiss' | 'reply';
export type Status = 'ready' | 'pending' | 'ended';
export type Source = 'rules' | 'authored' | 'live';
export type Params = Record<string, string>;
export interface Choice {
  actionId: string;
  label: string;
  hint?: string;
  control: 'button' | 'message' | 'gesture';
  targets?: { id: string; label: string; channel: string }[];
}
export type WordEffect = 'none' | 'ten' | 'bridge' | 'equal';
export interface WordPlay {
  x: number;
  y: number;
  rotation: 0 | 90;
  effect: WordEffect;
  discovered: Exclude<WordEffect, 'none'>[];
}
export interface FreePlay {
  actionId: string;
  maxLength: number;
  responseMode: 'local_echo' | 'live';
  targets: NonNullable<Choice['targets']>;
}
export interface VisibleEvent {
  eventId: string;
  stage: number;
  kind: string;
  actorId: string;
  actorName: string;
  audience: string[];
  channel: string;
  causeIds: string[];
  text: string;
  source: Source;
}
export interface Clue { id: string; title: string; text: string }
export interface Ending { id: string; title: string; text: string; line: string }
export interface Scene { title: string; kicker: string; text: string; prop: string }
export interface Checkpoint { id: string; stage: number; label: string }
export interface BranchLink { branchId: string; parentBranchId: string | null; label: string; endingTitle: string | null }
export interface ActiveRequest { requestId: string; actionId: string; label: string; startedAt: number; allowFallback: boolean }
export interface PlayerView {
  runId: string;
  branchId: string;
  episodeId: EpisodeId;
  scriptVersion: string;
  revision: number;
  stage: number;
  status: Status;
  scene: Scene;
  choices: Choice[];
  visibleEvents: VisibleEvent[];
  inventory: Clue[];
  checkpoints: Checkpoint[];
  branches: BranchLink[];
  activeRequest: ActiveRequest | null;
  ending: Ending | null;
  presentation: Record<string, string | boolean | number>;
  wordPlay?: WordPlay;
  freePlay?: FreePlay;
}
export interface EpisodeSummary { id: EpisodeId; title: string; shortTitle: string; role: string; cta: string; poster: string; color: string; version: string; hook: string; number: string; genre: string }
export interface TurnInput { requestId: string; expectedRevision: number; stage: number; actionId: string; params: Params }
export interface AcceptedTurn { requestId: string; status: 'pending'; pollUrl: string }
export interface GameTransport {
  mode: 'authored' | 'site';
  catalog(): Promise<EpisodeSummary[]>;
  create(episodeId: EpisodeId, createKey: string): Promise<PlayerView>;
  read(runId: string, branchId: string): Promise<PlayerView>;
  turn(runId: string, branchId: string, input: TurnInput): Promise<PlayerView | AcceptedTurn>;
  poll(runId: string, branchId: string, requestId: string): Promise<PlayerView | AcceptedTurn>;
  fallback(runId: string, branchId: string, requestId: string): Promise<PlayerView>;
  fork(runId: string, branchId: string, checkpointId: string, forkKey: string): Promise<PlayerView>;
}
export class GameError extends Error {
  constructor(public code: string, message: string, public retryable = false, public status = 400) { super(message); }
}
