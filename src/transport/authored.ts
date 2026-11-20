import { GameError, type GameTransport, type PlayerView, type TurnInput } from '../../shared/contracts';
import type { AuthoredStore } from '../../fixtures/authored-engine';

type Pending = { runId: string; branchId: string; input: TurnInput; due: number; startedAt: number; label: string };
type Saved = { store: AuthoredStore; pending: Record<string, Pending> };
const KEY = 'retake.authored.v1';

export function createAuthoredTransport(delay = 420): GameTransport {
  const engine = () => import('../../fixtures/authored-engine');
  const withLock = async <T,>(task: () => Promise<T>): Promise<T> => navigator.locks ? navigator.locks.request(KEY, task) : task();
  async function load(): Promise<Saved> {
    const api = await engine();
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : { store: api.emptyStore(), pending: {} };
    } catch { throw new GameError('LOCAL_SAVE_ERROR', '无法读取本机存档。请检查浏览器存储权限。', false); }
  }
  function save(data: Saved) {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { throw new GameError('LOCAL_SAVE_ERROR', '浏览器无法保存这一拍。请检查可用空间或存储权限。', false); }
  }
  async function getView(data: Saved, r: string, b: string): Promise<PlayerView> {
    const view = (await engine()).readBranch(data.store, r, b);
    const pending = Object.values(data.pending).find(p => p.runId === r && p.branchId === b);
    if (pending) {
      view.status = 'pending'; view.choices = []; delete view.freePlay;
      view.activeRequest = { requestId: pending.input.requestId, actionId: pending.input.actionId, label: pending.label, startedAt: pending.startedAt, allowFallback: pending.input.actionId !== 'free_dialogue' };
    }
    return view;
  }
  async function finish(r: string, b: string, id: string, force = false) {
    return withLock(async () => {
      const data = await load();
      const key = `${r}/${b}/${id}`;
      const pending = data.pending[key];
      if (!pending) return (await engine()).readBranch(data.store, r, b);
      if (force && pending.input.actionId === 'free_dialogue') throw new GameError('ACTION_UNAVAILABLE', '自由输入只有本机原文回显，不能切换成预写 NPC 回复。', false, 422);
      if (!force && Date.now() < pending.due) return { requestId: id, status: 'pending' as const, pollUrl: '' };
      const view = (await engine()).submitTurn(data.store, r, b, pending.input);
      delete data.pending[key];
      save(data);
      return view;
    });
  }
  return {
    mode: 'authored',
    catalog: async () => (await import('../../content/episodes')).episodes,
    create: (episodeId, createKey) => withLock(async () => { const data = await load(); const view = (await engine()).createRun(data.store, episodeId, createKey); save(data); return view; }),
    read: async (r, b) => getView(await load(), r, b),
    turn: (r, b, input) => withLock(async () => {
      const data = await load();
      const old = Object.values(data.pending).find(p => p.runId === r && p.branchId === b);
      if (old) {
        if (old.input.requestId === input.requestId && JSON.stringify(old.input) === JSON.stringify(input)) return { requestId: input.requestId, status: 'pending' as const, pollUrl: '' };
        throw new GameError('BUSY', '这一拍已经在接戏，请先等它完成。', true, 409);
      }
      const current = (await engine()).readBranch(data.store, r, b);
      const completed = (await engine()).submitTurn(structuredClone(data.store), r, b, input);
      if (completed.revision <= current.revision) return completed;
      const startedAt = Date.now();
      const label = input.actionId === 'move_one' ? '移动数字 1'
        : input.actionId === 'finish_wordplay' ? '以当前文字组合谢幕'
        : input.actionId === 'free_dialogue' ? `本机记录 · ${current.freePlay?.targets.find(target => target.id === input.params.target && target.channel === input.params.channel)?.label ?? input.params.target}`
        : current.choices.find(c => c.actionId === input.actionId)?.label ?? input.actionId;
      data.pending[`${r}/${b}/${input.requestId}`] = { runId: r, branchId: b, input, due: startedAt + delay, startedAt, label };
      save(data);
      return { requestId: input.requestId, status: 'pending' as const, pollUrl: '' };
    }),
    poll: (r, b, id) => finish(r, b, id),
    fallback: async (r, b, id) => await finish(r, b, id, true) as PlayerView,
    fork: (r, b, checkpointId, forkKey) => withLock(async () => {
      const data = await load();
      if (Object.values(data.pending).some(p => p.runId === r && p.branchId === b)) throw new GameError('BUSY', '先完成这一拍，再倒带。', true, 409);
      const view = (await engine()).forkBranch(data.store, r, b, checkpointId, forkKey); save(data); return view;
    }),
  };
}
