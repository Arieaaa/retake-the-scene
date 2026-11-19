import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createAuthoredTransport } from '../src/transport/authored';

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
it('本机存储被禁用时明确报错，不伪造存档成功', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('denied'); } });
  await expect(createAuthoredTransport().create('wedding', 'c')).rejects.toMatchObject({ code: 'LOCAL_SAVE_ERROR' });
});
