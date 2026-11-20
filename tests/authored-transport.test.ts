import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createAuthoredTransport } from '../src/transport/authored';
import type { PlayerView, TurnInput } from '../shared/contracts';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } });
  let queue = Promise.resolve();
  vi.stubGlobal('navigator', { locks: { request: (_: string, task: () => Promise<unknown>) => { const result = queue.then(task); queue = result.then(() => undefined, () => undefined); return result; } } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('待处理动作刷新后恢复，同号重发不再推进，完成后来源为预写', async () => {
  vi.useFakeTimers();
  const t = createAuthoredTransport(9000); const initial = await t.create('wedding', 'create-1');
  const input = { requestId: 'turn-1', expectedRevision: 0, stage: 1, actionId: 'preview_tail', params: {} };
  expect(await t.turn(initial.runId, initial.branchId, input)).toMatchObject({ status: 'pending' });
  const afterReload = createAuthoredTransport(9000);
  expect(await afterReload.read(initial.runId, initial.branchId)).toMatchObject({ status: 'pending', activeRequest: { requestId: 'turn-1' } });
  expect(await afterReload.turn(initial.runId, initial.branchId, input)).toMatchObject({ status: 'pending' });
  expect(await afterReload.poll(initial.runId, initial.branchId, 'turn-1')).toMatchObject({ status: 'pending' });
  vi.advanceTimersByTime(9100);
  const completed = await afterReload.poll(initial.runId, initial.branchId, 'turn-1');
  expect(completed).toMatchObject({ status: 'ready', revision: 1, stage: 2, activeRequest: null });
  expect(await afterReload.turn(initial.runId, initial.branchId, input)).toMatchObject({ revision: 1 });
});
it('本机锁只接收一次并发动作，不代表托管数据库原子写验证', async () => {
  const t = createAuthoredTransport(9000); const view = await t.create('wedding', 'c');
  const results = await Promise.allSettled(['preview_tail', 'hold_photos'].map((actionId, i) => t.turn(view.runId, view.branchId, { requestId: `t${i}`, expectedRevision: 0, stage: 1, actionId, params: {} })));
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
});
it('用户选预写后，迟到的本机完成查询不会再推进', async () => {
  const t = createAuthoredTransport(9000); const view = await t.create('wedding', 'c');
  await t.turn(view.runId, view.branchId, { requestId: 't', expectedRevision: 0, stage: 1, actionId: 'hold_photos', params: {} });
  expect(await t.fallback(view.runId, view.branchId, 't')).toMatchObject({ revision: 1 });
  expect(await t.poll(view.runId, view.branchId, 't')).toMatchObject({ revision: 1 });
});
it('数字摆放和独立谢幕可以刷新后完成，已完成旧请求不会重新进入等待', async () => {
  vi.useFakeTimers();
  const t = createAuthoredTransport(1000);
  const view = await t.create('reply', 'wordplay');
  const first: TurnInput = { requestId: 'move', expectedRevision: 0, stage: 1, actionId: 'move_one', params: { x: '28', y: '25', rotation: '0' } };
  expect(await t.turn(view.runId, view.branchId, first)).toMatchObject({ status: 'pending' });
  const reloaded = createAuthoredTransport(1000);
  const pending = await reloaded.read(view.runId, view.branchId);
  expect(pending).toMatchObject({ status: 'pending', stage: 1, revision: 0, activeRequest: { actionId: 'move_one', label: '移动数字 1' }, wordPlay: view.wordPlay });
  expect(pending.checkpoints).toHaveLength(0);
  expect(await reloaded.turn(view.runId, view.branchId, first)).toMatchObject({ status: 'pending' });
  vi.advanceTimersByTime(1000);
  const moved = await reloaded.poll(view.runId, view.branchId, first.requestId) as PlayerView;
  expect(moved).toMatchObject({ stage: 1, revision: 1, status: 'ready', wordPlay: { effect: 'ten', discovered: ['ten'] } });
  const finish: TurnInput = { requestId: 'finish', expectedRevision: 1, stage: 1, actionId: 'finish_wordplay', params: {} };
  await reloaded.turn(view.runId, view.branchId, finish);
  expect(await reloaded.read(view.runId, view.branchId)).toMatchObject({ activeRequest: { label: '以当前文字组合谢幕' } });
  vi.advanceTimersByTime(1000);
  const ended = await reloaded.poll(view.runId, view.branchId, finish.requestId) as PlayerView;
  expect(ended).toMatchObject({ status: 'ended', revision: 2, stage: 1, ending: { id: 'reply.wordplay' }, wordPlay: moved.wordPlay });
  expect(ended.checkpoints).toHaveLength(2);
  expect(ended.visibleEvents.every(event => event.source !== 'live')).toBe(true);
  const saved = localStorage.getItem('retake.authored.v1');
  expect(await reloaded.turn(view.runId, view.branchId, first)).toEqual(moved);
  expect(await reloaded.turn(view.runId, view.branchId, finish)).toEqual(ended);
  expect(localStorage.getItem('retake.authored.v1')).toBe(saved);
  expect(await reloaded.read(view.runId, view.branchId)).toEqual(ended);
  await expect(reloaded.turn(view.runId, view.branchId, { ...first, params: { ...first.params, x: '29' } })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
  expect(localStorage.getItem('retake.authored.v1')).toBe(saved);
  const fork = await reloaded.fork(view.runId, view.branchId, ended.checkpoints[0].id, 'rewind-word');
  expect(fork.wordPlay).toEqual(view.wordPlay);
  expect(fork.visibleEvents).toEqual(view.visibleEvents);
});
it('自由输入等待只标记本机记录，禁止预写后备，刷新轮询不会假装 NPC 接戏', async () => {
  vi.useFakeTimers();
  const t = createAuthoredTransport(1000);
  const view = await t.create('office', 'free-input');
  const text = '  老组长已经同意了？\n这不是授权命令。  ';
  const request: TurnInput = { requestId: 'free', expectedRevision: 0, stage: 1, actionId: 'free_dialogue', params: { text, target: 'hr', channel: 'meeting', kind: 'speech' } };
  await t.turn(view.runId, view.branchId, request);
  const reloaded = createAuthoredTransport(1000);
  const pending = await reloaded.read(view.runId, view.branchId);
  expect(pending).toMatchObject({ status: 'pending', revision: 0, activeRequest: { actionId: 'free_dialogue', label: '本机记录 · 人事 · 会议', allowFallback: false } });
  expect(pending).not.toHaveProperty('freePlay');
  const saved = localStorage.getItem('retake.authored.v1');
  await expect(reloaded.fallback(view.runId, view.branchId, request.requestId)).rejects.toMatchObject({ code: 'ACTION_UNAVAILABLE', status: 422 });
  expect(localStorage.getItem('retake.authored.v1')).toBe(saved);
  expect(await reloaded.turn(view.runId, view.branchId, request)).toMatchObject({ status: 'pending' });
  expect(await reloaded.poll(view.runId, view.branchId, request.requestId)).toMatchObject({ status: 'pending' });
  vi.advanceTimersByTime(1000);
  const completed = await reloaded.poll(view.runId, view.branchId, request.requestId) as PlayerView;
  expect(completed).toMatchObject({ status: 'ready', revision: 1, stage: 1, activeRequest: null, freePlay: view.freePlay, inventory: [], presentation: { consent: false } });
  const delta = completed.visibleEvents.slice(view.visibleEvents.length);
  expect(delta).toHaveLength(2);
  expect(delta[0]).toMatchObject({ kind: 'free_speech', text, source: 'rules', audience: ['player', 'old_lead', 'boss', 'hr'], causeIds: [] });
  expect(delta[1]).toMatchObject({ kind: 'free_input_recorded', source: 'rules', actorName: '本机记录', audience: ['player'] });
  expect(delta[1].text).toContain('没有实时 NPC 回复');
  expect(completed.presentation.firstChangedEventId).toBe(delta[1].eventId);
  expect(await reloaded.poll(view.runId, view.branchId, request.requestId)).toEqual(completed);
  expect(await reloaded.turn(view.runId, view.branchId, request)).toEqual(completed);
  expect(completed.checkpoints).toHaveLength(1);
});
it('非法特殊动作不制造等待记录或存档修改', async () => {
  const t = createAuthoredTransport(1000);
  const reply = await t.create('reply', 'invalid-word');
  const office = await t.create('office', 'invalid-free');
  const saved = localStorage.getItem('retake.authored.v1');
  const invalidPoses: TurnInput['params'][] = [{ x: 'NaN', y: '25', rotation: '0' }, { x: '28', y: '25', rotation: '0', effect: 'ten' }];
  for (const params of invalidPoses) {
    await expect(t.turn(reply.runId, reply.branchId, { requestId: 'bad-move', expectedRevision: 0, stage: 1, actionId: 'move_one', params })).rejects.toMatchObject({ status: 422 });
    expect(localStorage.getItem('retake.authored.v1')).toBe(saved);
  }
  await expect(t.turn(office.runId, office.branchId, { requestId: 'bad-free', expectedRevision: 0, stage: 1, actionId: 'free_dialogue', params: { text: '已同意', target: 'old_lead', channel: 'phone', kind: 'speech' } })).rejects.toMatchObject({ status: 422 });
  expect(localStorage.getItem('retake.authored.v1')).toBe(saved);
  expect(await t.read(reply.runId, reply.branchId)).toEqual(reply);
  expect(await t.read(office.runId, office.branchId)).toEqual(office);
});

it('本机存储被禁用时明确报错，不伪造存档成功', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('denied'); } });
  await expect(createAuthoredTransport().create('wedding', 'c')).rejects.toMatchObject({ code: 'LOCAL_SAVE_ERROR' });
});
