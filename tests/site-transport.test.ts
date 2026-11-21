import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSiteTransport } from '../src/transport/site';
import { GameError } from '../shared/contracts';

afterEach(() => vi.unstubAllGlobals());
describe('B 同源 Function 边界', () => {
  it('先确认匿名会话，再用原createKey建局', async () => {
    const fetch = vi.fn().mockImplementation((url: string) => Promise.resolve(Response.json(url.endsWith('/session') ? { ok: true } : { runId: 'r' })));
    vi.stubGlobal('fetch', fetch);
    await createSiteTransport().create('wedding', 'create-1');
    expect(fetch.mock.calls.map(call => call[0])).toEqual(['/functions/v1/app/api/session', '/functions/v1/app/api/runs']);
    expect(fetch).toHaveBeenLastCalledWith('/functions/v1/app/api/runs', expect.objectContaining({ body: JSON.stringify({ episodeId: 'wedding', createKey: 'create-1' }) }));
  });
  it('会话失败不抢先建局，重试保留createKey', async () => {
    let fail = true;
    const fetch = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/session')) return Promise.resolve(fail ? Response.json({ code: 'SERVICE_UNAVAILABLE', retryable: true }, { status: 503 }) : Response.json({ ok: true }));
      return Promise.resolve(Response.json({ runId: 'r' }));
    });
    vi.stubGlobal('fetch', fetch);
    const transport = createSiteTransport();
    await expect(transport.create('wedding', 'create-1')).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
    fail = false;
    await transport.create('wedding', 'create-1');
    expect(fetch).toHaveBeenLastCalledWith('/functions/v1/app/api/runs', expect.objectContaining({ body: JSON.stringify({ episodeId: 'wedding', createKey: 'create-1' }) }));
  });
  it('错误的会话成功载荷不当作已建立身份', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ runId: 'not-a-session' })));
    vi.stubGlobal('fetch', fetch);
    await expect(createSiteTransport().create('office', 'create-2')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('提交携带同源 Cookie 且沿用 requestId，不把密钥交给浏览器', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ requestId: 'turn-7', status: 'pending', pollUrl: '/api/runs/r1/branches/b1/turns/turn-7' }), { status: 202 }));
    vi.stubGlobal('fetch', fetch);
    const input = { requestId: 'turn-7', expectedRevision: 1, stage: 2, actionId: 'private_preview', params: { target: 'writer' } };
    expect(await createSiteTransport().turn('r1', 'b1', input)).toMatchObject({ requestId: 'turn-7', status: 'pending' });
    expect(fetch).toHaveBeenCalledWith('/functions/v1/app/api/runs/r1/branches/b1/turns', expect.objectContaining({ method: 'POST', credentials: 'same-origin', body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' } }));
  });
  it.each([[409, 'VERSION_CONFLICT'], [422, 'ACTION_UNAVAILABLE'], [429, 'RATE_LIMITED'], [503, 'SERVICE_UNAVAILABLE']])('保留 HTTP %s 的业务错误 %s', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code, message: '可读错误', retryable: true }), { status: Number(status) })));
    await expect(createSiteTransport().read('r', 'b')).rejects.toMatchObject({ code, status, retryable: true });
  });
  it('断网不会偷偷切换作者模式', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(createSiteTransport().catalog()).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
  });
  it('未识别的响应清晰报错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>missing</html>', { status: 200 })));
    await expect(createSiteTransport().catalog()).rejects.toBeInstanceOf(GameError);
  });
  it('标识编码，恢复和倒带映射到固定子路由', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetch);
    const t = createSiteTransport(); await t.fork('r/a', 'b?x', 'c1', 'fork1');
    expect(fetch).toHaveBeenCalledWith('/functions/v1/app/api/runs/r%2Fa/branches/b%3Fx/forks', expect.objectContaining({ body: JSON.stringify({ checkpointId: 'c1', forkKey: 'fork1' }) }));
    await t.fallback('r', 'b', 'turn-7');
    expect(fetch).toHaveBeenLastCalledWith('/functions/v1/app/api/runs/r/branches/b/turns/turn-7/fallback', expect.objectContaining({ body: '{}' }));
  });
});
