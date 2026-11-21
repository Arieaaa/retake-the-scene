import { episodes } from '../../content/episodes';
import { GameError, SCRIPT_VERSION, type EpisodeId, type PlayerView, type TurnInput } from '../../shared/contracts';
import { createRun, emptyStore, forkBranch, readBranch, submitTurn, type GameStore } from './engine';
import type { GameRepository, RunRecord, VisitorRecord } from '../store/repository';

const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MAX_BRANCHES = 16;
const MAX_TURNS = 64;
const absent = () => new GameError('NOT_FOUND', '找不到这场演出，或当前访客无权访问。', false, 404);
const conflict = () => new GameError('VERSION_CONFLICT', '舞台已变化，请读取最新状态后重试。', true, 409);

function present(view: PlayerView): PlayerView {
  return {
    runId: view.runId, branchId: view.branchId, episodeId: view.episodeId, scriptVersion: view.scriptVersion,
    revision: view.revision, stage: view.stage, status: view.status,
    scene: { ...view.scene, kicker: view.scene.kicker.replace('作者预演', '编剧预写') },
    choices: view.choices, visibleEvents: view.visibleEvents, inventory: view.inventory,
    checkpoints: view.checkpoints, branches: view.branches, activeRequest: null, ending: view.ending,
    presentation: { ...view.presentation, mode: 'site', sourceLabel: '服务端存档 · 编剧预写（非实时 NPC）' },
    ...(view.wordPlay ? { wordPlay: view.wordPlay } : {}),
  };
}

function enforceCapacity(document: GameStore) {
  if (Object.values(document.runs).some(run => Object.keys(run.branches).length > MAX_BRANCHES
    || Object.values(run.branches).some(branch => Object.keys(branch.requests).length > MAX_TURNS))
    || new TextEncoder().encode(JSON.stringify(document)).byteLength > MAX_DOCUMENT_BYTES) {
    throw new GameError('SAVE_LIMIT', '本局已达到存档容量，请回片单另开一局；已有记录仍可回看。', false, 429);
  }
}

export class GameService {
  constructor(private repository: GameRepository, private now = Date.now) {}

  catalog() { return structuredClone(episodes); }

  private async owned(owner: VisitorRecord, id: string): Promise<RunRecord> {
    const record = await this.repository.findRun(owner.tokenHash, id);
    if (!record || record.expiresAt <= this.now() || owner.expiresAt <= this.now()) throw absent();
    const run = record.document.runs[id];
    if (record.stateVersion !== 1 || !run || run.scriptVersion !== SCRIPT_VERSION
      || Object.values(run.branches).some(branch => branch.state.scriptVersion !== SCRIPT_VERSION)) {
      throw new GameError('SCRIPT_UNAVAILABLE', '这个存档的剧本版本暂不可用，请保留存档并联系维护者。', false, 503);
    }
    return record;
  }

  async create(owner: VisitorRecord, episodeId: EpisodeId, createKey: string) {
    if (owner.expiresAt <= this.now()) throw absent();
    const existing = await this.repository.findCreatedRun(owner.tokenHash, createKey);
    if (existing) {
      const record = await this.owned(owner, existing.id);
      return { view: present(createRun(record.document, episodeId, createKey)), created: false };
    }
    const document = emptyStore();
    const view = createRun(document, episodeId, createKey);
    const record: RunRecord = { id: view.runId, ownerHash: owner.tokenHash, createKey, episodeId,
      expiresAt: owner.expiresAt, version: 0, stateVersion: 1, document };
    if (await this.repository.insertRun(record)) return { view: present(view), created: true };
    const winner = await this.repository.findCreatedRun(owner.tokenHash, createKey);
    if (!winner) throw conflict();
    const saved = await this.owned(owner, winner.id);
    return { view: present(createRun(saved.document, episodeId, createKey)), created: false };
  }

  async read(owner: VisitorRecord, runId: string, branchId: string) {
    const record = await this.owned(owner, runId);
    return present(readBranch(record.document, runId, branchId));
  }

  private async change(owner: VisitorRecord, runId: string, action: (document: GameStore) => PlayerView) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const record = await this.owned(owner, runId);
      const before = JSON.stringify(record.document);
      const view = action(record.document);
      if (before === JSON.stringify(record.document)) return { view: present(view), changed: false };
      enforceCapacity(record.document);
      if (await this.repository.compareAndSetRun({ ...record, version: record.version + 1 }, record.version)) {
        return { view: present(view), changed: true };
      }
    }
    throw conflict();
  }

  async turn(owner: VisitorRecord, runId: string, branchId: string, input: TurnInput) {
    return (await this.change(owner, runId, document => {
      const view = readBranch(document, runId, branchId);
      if (input.actionId === 'free_dialogue') {
        throw new GameError('AGENT_UNAVAILABLE', '实时 NPC 尚未接入，此版本仅支持已提供的剧情动作。', false, 422);
      }
      if (view.episodeId === 'reply' && /^(quote|reply)_/.test(input.actionId) && !input.params.parentMessageId) {
        throw new GameError('ACTION_UNAVAILABLE', '请明确选择当前可见的引用消息。', false, 422);
      }
      if (view.episodeId === 'romance' && input.actionId === 'ask_friend' && !input.params.forwardEventId) {
        throw new GameError('ACTION_UNAVAILABLE', '请先预览并确认要转发的消息。', false, 422);
      }
      return submitTurn(document, runId, branchId, input);
    })).view;
  }

  async receipt(owner: VisitorRecord, runId: string, branchId: string, requestId: string) {
    const record = await this.owned(owner, runId);
    readBranch(record.document, runId, branchId);
    const receipt = record.document.runs[runId].branches[branchId].requests[JSON.stringify(requestId)];
    if (!receipt) throw absent();
    return present(structuredClone(receipt.result));
  }

  async fork(owner: VisitorRecord, runId: string, branchId: string, checkpointId: string, forkKey: string) {
    return this.change(owner, runId, document => forkBranch(document, runId, branchId, checkpointId, forkKey));
  }
}
