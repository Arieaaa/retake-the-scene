import { GameError, type GameTransport, type EpisodeId, type PlayerView, type AcceptedTurn, type TurnInput, type EpisodeSummary } from '../../shared/contracts';

export function createSiteTransport(base = '/functions/v1/app'): GameTransport {
  async function request<T>(path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new GameError('NETWORK_ERROR', '网络断开了。你的选择还在，重试会沿用同一请求。', true, 503);
    }
    let data: unknown;
    try { data = await response.json(); } catch { throw new GameError('INVALID_RESPONSE', '演出服务没有返回可识别的结果，请稍后重试。', true, 503); }
    if (!response.ok) {
      const error = data as { code?: string; message?: string; retryable?: boolean };
      throw new GameError(error.code ?? 'SERVICE_ERROR', error.message ?? '演出服务暂时不可用。', error.retryable ?? response.status >= 500, response.status);
    }
    return data as T;
  }
  const branch = (r: string, b: string) => `/api/runs/${encodeURIComponent(r)}/branches/${encodeURIComponent(b)}`;
  return {
    mode: 'site',
    catalog: () => request<EpisodeSummary[]>('/api/episodes'),
    create: async (episodeId: EpisodeId, createKey: string) => {
      const create = async () => {
        const session = await request<{ ok: boolean }>('/api/session', {});
        if (session?.ok !== true) throw new GameError('INVALID_RESPONSE', '访客会话没有建立，请重试原操作。', true, 503);
        return request<PlayerView>('/api/runs', { episodeId, createKey });
      };
      return typeof navigator !== 'undefined' && navigator.locks
        ? navigator.locks.request('retake.site-session', create) : create();
    },
    read: (r, b) => request<PlayerView>(branch(r, b)),
    turn: (r, b, input: TurnInput) => request<PlayerView | AcceptedTurn>(`${branch(r, b)}/turns`, input),
    poll: (r, b, id) => request<PlayerView | AcceptedTurn>(`${branch(r, b)}/turns/${encodeURIComponent(id)}`),
    fallback: (r, b, id) => request<PlayerView>(`${branch(r, b)}/turns/${encodeURIComponent(id)}/fallback`, {}),
    fork: (r, b, checkpointId, forkKey) => request<PlayerView>(`${branch(r, b)}/forks`, { checkpointId, forkKey }),
  };
}
