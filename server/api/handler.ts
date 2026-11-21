import { GameError, type EpisodeId, type TurnInput } from '../../shared/contracts';
import { GameService } from '../game/service';
import type { GameRepository, VisitorRecord } from '../store/repository';

const TTL_SECONDS = 14 * 24 * 60 * 60;
const badInput = () => new GameError('INVALID_INPUT', '请求参数无效。', false, 400);
const notFound = () => new GameError('NOT_FOUND', '找不到这场演出，或当前访客无权访问。', false, 404);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badInput();
}
function fields(value: Record<string, unknown>, required: string[]) {
  if (Object.keys(value).length !== required.length || required.some(key => !Object.hasOwn(value, key))) throw badInput();
}
function key(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) throw badInput();
}
async function jsonBody(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw badInput();
  const reader = request.body?.getReader();
  if (!reader) throw badInput();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8192) {
        await reader.cancel();
        throw new GameError('PAYLOAD_TOO_LARGE', '请求正文不能超过 8 KB。', false, 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw badInput(); }
  object(value);
  return value;
}
async function digest(token: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
    byte => byte.toString(16).padStart(2, '0')).join('');
}
function response(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Vary': 'Cookie',
    'X-Content-Type-Options': 'nosniff', ...headers } });
}

export function createHandler(options: {
  repository: GameRepository;
  origin: string;
  allowInsecureLocalhost?: boolean;
  now?: () => number;
}) {
  const origin = new URL(options.origin);
  if (origin.origin !== options.origin || origin.username || origin.password) throw new Error('Use a canonical application origin.');
  const local = options.allowInsecureLocalhost === true && origin.protocol === 'http:'
    && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname);
  if (!local && origin.protocol !== 'https:') throw new Error('Anonymous sessions require HTTPS outside local development.');
  const cookieName = local ? 'retake_visitor_local' : '__Host-retake_visitor';
  const now = options.now ?? Date.now;
  const game = new GameService(options.repository, now);

  async function visitor(request: Request): Promise<VisitorRecord | null> {
    const tokens = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim())
      .filter(part => part.startsWith(`${cookieName}=`)).map(part => part.slice(cookieName.length + 1));
    if (tokens.length !== 1 || !/^[0-9a-f]{64}$/.test(tokens[0])) return null;
    const found = await options.repository.findVisitor(await digest(tokens[0]));
    return found && found.expiresAt > now() ? found : null;
  }

  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const prefix = url.pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/);
      if (!prefix) throw notFound();
      const path = prefix[1] ?? '/';
      const route = path.match(/^\/api\/runs\/([^/]+)\/branches\/([^/]+)(?:\/(turns|forks)(?:\/([^/]+)(\/fallback)?)?)?$/);
      const method = path === '/api/episodes' ? 'GET'
        : path === '/api/session' || path === '/api/runs' ? 'POST'
        : route ? !route[3] || (route[3] === 'turns' && route[4] && !route[5]) ? 'GET' : 'POST' : null;
      if (!method || (route?.[3] === 'forks' && route[4])) throw notFound();
      if (request.method !== method) return response({ code: 'METHOD_NOT_ALLOWED', message: '此接口不支持该请求方法。', retryable: false }, 405, { Allow: method });
      if ([...url.searchParams.keys()].some(name => name !== 'afterEventId')
        || (url.search && (!route || route[3]))) throw badInput();
      if (method === 'POST' && (request.headers.get('origin') !== origin.origin
        || request.headers.get('sec-fetch-site') === 'cross-site')) {
        throw new GameError('ORIGIN_DENIED', '写入请求必须来自本站。', false, 403);
      }
      if (path === '/api/episodes') return response(game.catalog());
      const body = method === 'POST' ? await jsonBody(request) : null;
      const owner = await visitor(request);
      if (path === '/api/session') {
        fields(body!, []);
        if (owner) return response({ ok: true });
        const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
        await options.repository.createVisitor({ tokenHash: await digest(token), expiresAt: now() + TTL_SECONDS * 1000 });
        return response({ ok: true }, 200, { 'Set-Cookie': `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_SECONDS}${local ? '' : '; Secure'}` });
      }
      if (!owner) {
        if (path === '/api/runs') throw new GameError('SESSION_REQUIRED', '请先建立访客会话，再沿用原操作重试。', true, 401);
        throw notFound();
      }
      if (path === '/api/runs') {
        fields(body!, ['episodeId', 'createKey']);
        key(body!.createKey);
        if (!game.catalog().some(episode => episode.id === body!.episodeId)) throw badInput();
        const result = await game.create(owner, body!.episodeId as EpisodeId, body!.createKey);
        return response(result.view, result.created ? 201 : 200);
      }
      let runId: string, branchId: string, requestId: string | undefined;
      try { runId = decodeURIComponent(route![1]); branchId = decodeURIComponent(route![2]); requestId = route![4] ? decodeURIComponent(route![4]) : undefined; }
      catch { throw badInput(); }
      if (!uuid.test(runId) || !uuid.test(branchId)) throw notFound();
      if (requestId !== undefined) key(requestId);
      if (!route![3]) {
        const view = await game.read(owner, runId, branchId);
        const cursor = url.searchParams.get('afterEventId');
        if (cursor === null) return response(view);
        key(cursor);
        const index = view.visibleEvents.findIndex(event => event.eventId === cursor);
        return response({ ...view, visibleEvents: index < 0 ? view.visibleEvents : view.visibleEvents.slice(index + 1), reset: index < 0 });
      }
      if (route![3] === 'forks') {
        fields(body!, ['checkpointId', 'forkKey']);
        key(body!.checkpointId); key(body!.forkKey);
        const result = await game.fork(owner, runId, branchId, body!.checkpointId, body!.forkKey);
        return response(result.view, result.changed ? 201 : 200);
      }
      if (requestId !== undefined) {
        if (route![5]) fields(body!, []);
        return response(await game.receipt(owner, runId, branchId, requestId));
      }
      fields(body!, ['requestId', 'expectedRevision', 'stage', 'actionId', 'params']);
      key(body!.requestId); key(body!.actionId);
      if (!Number.isSafeInteger(body!.expectedRevision) || Number(body!.expectedRevision) < 0
        || !Number.isInteger(body!.stage) || Number(body!.stage) < 1 || Number(body!.stage) > 3) throw badInput();
      object(body!.params);
      if (Object.values(body!.params).some(value => typeof value !== 'string')) throw badInput();
      return response(await game.turn(owner, runId, branchId, body as unknown as TurnInput));
    } catch (error) {
      const safe = error instanceof GameError ? error : new GameError('SERVICE_UNAVAILABLE', '演出服务暂时不可用，请沿用原请求重试。', true, 503);
      return response({ code: safe.code, message: safe.message, retryable: safe.retryable }, safe.status);
    }
  };
}
