import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import acceptance from '../../五剧十五结局-验收样例.json';
import { SCRIPT_VERSION, type EpisodeId, type Params, type PlayerView, type TurnInput } from '../../shared/contracts';
import { createHandler } from '../../server/api/handler';
import { SqliteRepository } from '../../server/store/sqlite';

const ORIGIN = 'https://retake.test';
const COOKIE_NAME = '__Host-retake_visitor';
const TTL = 14 * 24 * 60 * 60 * 1000;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const tokenOf = (cookie: string) => cookie.slice(cookie.indexOf('=') + 1);
const branchPath = (view: PlayerView) => `/api/runs/${view.runId}/branches/${view.branchId}`;
type Step = { stage: number; actionId: string; params?: Params };
type HttpOptions = {
  method?: string; body?: unknown; raw?: string; origin?: string | null;
  headers?: Record<string, string>; prefix?: string;
};
let repository: SqliteRepository;
let handle: ReturnType<typeof createHandler>;
let time: number;

beforeEach(() => {
  time = Date.UTC(2026, 0, 1);
  repository = new SqliteRepository(':memory:');
  handle = createHandler({ repository, origin: ORIGIN, now: () => time });
});
afterEach(() => { vi.restoreAllMocks(); repository?.close(); });

function request(path: string, cookie = '', options: HttpOptions = {}) {
  const { method = 'GET', body, raw, origin = ORIGIN, headers = {}, prefix = '/functions/v1/app' } = options;
  const requestHeaders = new Headers({ 'Content-Type': 'application/json', ...headers });
  if (origin !== null) requestHeaders.set('Origin', origin);
  if (cookie) requestHeaders.set('Cookie', cookie);
  return handle(new Request(`${ORIGIN}${prefix}${path}`, {
    method, headers: requestHeaders, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  }));
}
const post = (path: string, cookie: string, body: unknown) => request(path, cookie, { method: 'POST', body });
async function json<T>(pending: Promise<Response>, status = 200): Promise<T> {
  const response = await pending;
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return body as T;
}
async function rejected(pending: Promise<Response>, status: number, code?: string) {
  const error = await json<{ code: string; message: string; retryable: boolean }>(pending, status);
  expect(error).toEqual({ code: code ?? expect.any(String), message: expect.any(String), retryable: expect.any(Boolean) });
}
async function session() {
  const response = await post('/api/session', '', {});
  expect(await json(Promise.resolve(response.clone()))).toEqual({ ok: true });
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  expect(cookie).toMatch(/^__Host-retake_visitor=[0-9a-f]{64}$/);
  return cookie!;
}
async function start(cookie: string, episodeId: EpisodeId = 'wedding', createKey: string = randomUUID()) {
  return json<PlayerView>(post('/api/runs', cookie, { episodeId, createKey }), 201);
}
function input(view: PlayerView, actionId: string, params: Params = {}, requestId: string = randomUUID()): TurnInput {
  return { requestId, expectedRevision: view.revision, stage: view.stage, actionId, params };
}
function turn(cookie: string, view: PlayerView, actionId: string, params: Params = {}, requestId?: string) {
  return json<PlayerView>(post(`${branchPath(view)}/turns`, cookie, input(view, actionId, params, requestId)));
}
// The external JSON remains the oracle; only references requiring current event IDs are supplied here.
function stepParams(view: PlayerView, step: Step): Params {
  const params = { ...step.params };
  if (view.episodeId === 'reply' && /^(quote|reply)_/.test(step.actionId)) {
    const parent = view.presentation[`${step.actionId}ParentMessageId`];
    expect(typeof parent).toBe('string');
    params.parentMessageId = parent as string;
  }
  if (view.episodeId === 'romance' && step.actionId === 'ask_friend') {
    const preview = view.presentation.friendForwardPreviewEventId;
    expect(typeof preview).toBe('string');
    params.forwardEventId = preview as string;
  }
  return params;
}
async function record(cookie: string, view: PlayerView) {
  const saved = await repository.findRun(hash(tokenOf(cookie)), view.runId);
  expect(saved).not.toBeNull();
  return saved!;
}
async function unchanged(cookie: string, view: PlayerView, operation: () => Promise<void>) {
  // Inspect the actual SQLite row, including its CAS version, receipts and checkpoints; no repository mocks.
  const before = await record(cookie, view);
  await operation();
  expect(await record(cookie, view)).toEqual(before);
}
function authoredProjection(view: PlayerView) {
  expect(view).not.toHaveProperty('view');
  expect(view).not.toHaveProperty('freePlay');
  expect(view.presentation.mode).toBe('site');
  expect(view.presentation.sourceLabel).toContain('非实时 NPC');
  expect(view.activeRequest).toBeNull();
  const seen = new Set<string>();
  for (const event of view.visibleEvents) {
    expect(['rules', 'authored']).toContain(event.source);
    expect(event.source).not.toBe('live');
    expect(event.audience).toContain('player');
    expect(seen.has(event.eventId)).toBe(false);
    for (const cause of event.causeIds) expect(seen.has(cause), `${event.kind}: unavailable cause ${cause}`).toBe(true);
    seen.add(event.eventId);
  }
}
function protectedRequests(view: PlayerView, requestId: string) {
  const path = branchPath(view);
  return [
    { path, options: {} },
    { path: `${path}?afterEventId=unknown`, options: {} },
    { path: `${path}/turns`, options: { method: 'POST', body: input(view, view.choices[0].actionId) } },
    { path: `${path}/forks`, options: { method: 'POST', body: { checkpointId: view.checkpoints[0].id, forkKey: 'foreign-fork' } } },
    { path: `${path}/turns/${requestId}`, options: {} },
    { path: `${path}/turns/${requestId}/fallback`, options: { method: 'POST', body: {} } },
  ];
}

describe('real Fetch handler + SQLite: original five episodes / fifteen endings', () => {
  it('keeps the original acceptance artifact and all fifteen distinct expectations', () => {
    expect(acceptance.mode).toBe('authored');
    expect(acceptance.scriptVersion).toBe(SCRIPT_VERSION);
    expect(acceptance.cases).toHaveLength(15);
    expect(new Set(acceptance.cases.map(item => item.episodeId)).size).toBe(5);
    expect(new Set(acceptance.cases.map(item => item.expected.endingId)).size).toBe(15);
  });
  it.each(acceptance.cases)('$caseId: $expected.title', async testCase => {
    const cookie = await session();
    let view = await start(cookie, testCase.episodeId as EpisodeId, testCase.caseId);
    authoredProjection(view);
    for (const [index, step] of testCase.turns.entries()) {
      expect(view.stage).toBe(step.stage);
      expect(view.choices.map(choice => choice.actionId)).toContain(step.actionId);
      view = await turn(cookie, view, step.actionId, stepParams(view, step));
      expect(view.revision).toBe(index + 1);
      authoredProjection(view);
    }
    expect(view.status).toBe('ended');
    expect(view.choices).toEqual([]);
    expect(view.ending).toMatchObject({ id: testCase.expected.endingId, title: testCase.expected.title, text: testCase.expected.visibleResult });
    for (const kind of testCase.expected.requiredEvents) expect(view.visibleEvents.map(event => event.kind)).toContain(kind);
    expect(await json(request(branchPath(view), cookie))).toEqual(view);
    expect((await record(cookie, view)).version).toBe(testCase.turns.length);
  });
});

describe('sessions, ownership and routing', () => {
  it('requires a session first and stores only its SHA-256 digest with a secure host-only cookie', async () => {
    const create = { episodeId: 'wedding', createKey: 'first' };
    const unauthorized = await post('/api/runs', '', create);
    expect(unauthorized.headers.get('set-cookie')).toBeNull();
    await rejected(Promise.resolve(unauthorized), 401, 'SESSION_REQUIRED');
    const response = await post('/api/session', '', {});
    expect(await json(Promise.resolve(response.clone()))).toEqual({ ok: true });
    const setCookie = response.headers.get('set-cookie')!;
    const cookie = setCookie.split(';')[0];
    expect(cookie).toMatch(/^__Host-retake_visitor=[0-9a-f]{64}$/);
    for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${TTL / 1000}`]) {
      expect(setCookie.split(';').map(part => part.trim())).toContain(attribute);
    }
    expect(setCookie.toLowerCase()).not.toContain('domain=');
    const visitor = { tokenHash: hash(tokenOf(cookie)), expiresAt: time + TTL };
    expect(await repository.findVisitor(visitor.tokenHash)).toEqual(visitor);
    expect(await repository.findVisitor(tokenOf(cookie))).toBeNull();
    const reused = await post('/api/session', cookie, {});
    expect(await json(Promise.resolve(reused.clone()))).toEqual({ ok: true });
    expect(reused.headers.get('set-cookie')).toBeNull();
    expect(await repository.findVisitor(visitor.tokenHash)).toEqual(visitor);
    const view = await json<PlayerView>(post('/api/runs', cookie, create), 201);
    expect(await record(cookie, view)).toMatchObject({ ownerHash: visitor.tokenHash, expiresAt: visitor.expiresAt, version: 0 });
    expect(JSON.stringify(view)).not.toContain(visitor.tokenHash);
    expect(JSON.stringify(view)).not.toContain(tokenOf(cookie));
  });

  it('does not accept a client-supplied owner on any write route', async () => {
    const cookie = await session();
    const view = await turn(cookie, await start(cookie), 'hold_photos');
    await unchanged(cookie, view, async () => {
      for (const [path, body] of [
        ['/api/session', {}], ['/api/runs', { episodeId: 'wedding', createKey: 'client-owner' }],
        [`${branchPath(view)}/turns`, input(view, 'watch_table')],
        [`${branchPath(view)}/forks`, { checkpointId: view.checkpoints[0].id, forkKey: 'client-owner' }],
      ] as const) {
        for (const ownerField of ['owner', 'ownerHash', 'visitorId']) {
          await rejected(post(path, cookie, { ...body, [ownerField]: hash(tokenOf(cookie)) }), 400, 'INVALID_INPUT');
        }
      }
    });
    expect(await repository.findCreatedRun(hash(tokenOf(cookie)), 'client-owner')).toBeNull();
  });

  it('isolates two independent cookies for reads, turns, forks, polls and fallback receipts in both directions', async () => {
    const a = await session(), b = await session();
    expect(a).not.toBe(b);
    const av = await turn(a, await start(a, 'wedding', 'shared-key'), 'hold_photos', {}, 'receipt');
    const bv = await turn(b, await start(b, 'office', 'shared-key'), 'read_roster', {}, 'receipt');
    expect(av.runId).not.toBe(bv.runId);
    for (const [owner, intruder, view] of [[a, b, av], [b, a, bv]] as const) {
      await unchanged(owner, view, async () => {
        for (const call of protectedRequests(view, 'receipt')) {
          await rejected(request(call.path, intruder, call.options), 404, 'NOT_FOUND');
          await rejected(request(call.path, '', call.options), 404, 'NOT_FOUND');
        }
        expect(await json(request(branchPath(view), owner))).toEqual(view);
      });
    }
  });

  it('rejects a guessed branch ID from another run even for the same owner', async () => {
    const cookie = await session();
    const a = await turn(cookie, await start(cookie), 'hold_photos', {}, 'receipt');
    const b = await turn(cookie, await start(cookie), 'hold_photos', {}, 'receipt');
    await unchanged(cookie, a, async () => {
      await unchanged(cookie, b, async () => {
        for (const view of [{ ...a, branchId: b.branchId }, { ...b, branchId: a.branchId }]) {
          for (const call of protectedRequests(view, 'receipt')) await rejected(request(call.path, cookie, call.options), 404, 'NOT_FOUND');
        }
      });
    });
  });

  it.each(['session', 'run'] as const)('returns 404 at the exact %s expiry boundary without writes', async expiry => {
    const cookie = await session();
    const view = await turn(cookie, await start(cookie), 'hold_photos', {}, 'receipt');
    if (expiry === 'run') {
      // Shorten only the persisted run lifetime to exercise expiry with a still-valid visitor.
      const saved = await record(cookie, view);
      expect(await repository.compareAndSetRun({ ...saved, expiresAt: time + 1000, version: saved.version + 1 }, saved.version)).toBe(true);
      time += 1000;
    } else time += TTL;
    await unchanged(cookie, view, async () => {
      for (const call of protectedRequests(view, 'receipt')) await rejected(request(call.path, cookie, call.options), 404, 'NOT_FOUND');
      if (expiry === 'session') await rejected(post('/api/runs', cookie, { episodeId: 'wedding', createKey: 'expired' }), 401);
    });
  });

  it('rejects duplicate, injected and self-selected unregistered cookie tokens', async () => {
    const cookie = await session();
    const view = await start(cookie);
    const unknown = `${COOKIE_NAME}=${'0'.repeat(64)}`;
    expect(await repository.findVisitor(hash('0'.repeat(64)))).toBeNull();
    await unchanged(cookie, view, async () => {
      for (const attack of [unknown, `${cookie}; ${cookie}`, `${cookie}; ${unknown}`, `${unknown}; ${cookie}`,
        `${cookie}' OR 1=1--`, `${COOKIE_NAME}=%${tokenOf(cookie)}`, `${cookie}=extra`]) {
        await rejected(post('/api/runs', attack, { episodeId: 'wedding', createKey: 'attack' }), 401, 'SESSION_REQUIRED');
        await rejected(request(branchPath(view), attack), 404, 'NOT_FOUND');
      }
    });
    const bootstrap = await post('/api/session', unknown, {});
    expect(await json(Promise.resolve(bootstrap.clone()))).toEqual({ ok: true });
    expect(bootstrap.headers.get('set-cookie')?.split(';')[0]).not.toBe(unknown);
    expect(await repository.findVisitor(hash('0'.repeat(64)))).toBeNull();
  });

  it('exposes only public episode summaries anonymously', async () => {
    const response = await request('/api/episodes', '', { origin: null });
    expect(response.headers.get('set-cookie')).toBeNull();
    const catalog = await json<Record<string, unknown>[]>(Promise.resolve(response));
    expect(catalog.map(item => item.id).sort()).toEqual(['hiss', 'office', 'reply', 'romance', 'wedding']);
    const publicKeys = ['id', 'title', 'shortTitle', 'role', 'cta', 'poster', 'color', 'version', 'hook', 'number', 'genre'].sort();
    for (const episode of catalog) expect(Object.keys(episode).sort()).toEqual(publicKeys);
    expect(JSON.stringify(catalog)).not.toMatch(/consent_granted|fallbackLine|preconditions|trigger|private_preview/);
  });

  it.each(['/functions/v1/app', '/app', `/functions/v1/app-d${'a'.repeat(32)}`, `/app-d${'b'.repeat(32)}`])(
    'routes session, create, read and writes through %s', async prefix => {
      const bootstrap = await request('/api/session', '', { prefix, method: 'POST', body: {} });
      expect(await json(Promise.resolve(bootstrap.clone()))).toEqual({ ok: true });
      const cookie = bootstrap.headers.get('set-cookie')!.split(';')[0];
      const initial = await json<PlayerView>(request('/api/runs', cookie, { prefix, method: 'POST', body: { episodeId: 'wedding', createKey: 'prefix' } }), 201);
      const view = await json<PlayerView>(request(`${branchPath(initial)}/turns`, cookie, { prefix, method: 'POST', body: input(initial, 'hold_photos') }));
      expect(view.revision).toBe(1);
      expect(await json(request(branchPath(view), cookie, { prefix }))).toEqual(view);
    },
  );
});

describe('idempotency, races and read-only receipts', () => {
  it('returns the same initial view for createKey retries after progress, but rejects a changed episode', async () => {
    const cookie = await session();
    const initial = await start(cookie, 'wedding', 'create-once');
    const progressed = await turn(cookie, initial, 'hold_photos');
    await unchanged(cookie, progressed, async () => {
      expect(await json(post('/api/runs', cookie, { episodeId: 'wedding', createKey: 'create-once' }))).toEqual(initial);
      await rejected(post('/api/runs', cookie, { episodeId: 'office', createKey: 'create-once' }), 409, 'VERSION_CONFLICT');
      expect(await json(request(branchPath(progressed), cookie))).toEqual(progressed);
    });
  });

  it('deduplicates simultaneous creates using the SQLite owner/createKey constraint', async () => {
    const cookie = await session();
    const body = { episodeId: 'wedding', createKey: 'concurrent-create' };
    const responses = await Promise.all([post('/api/runs', cookie, body), post('/api/runs', cookie, body)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 201]);
    const [a, b] = await Promise.all(responses.map(response => response.json() as Promise<PlayerView>));
    expect(a).toEqual(b);
    expect(await record(cookie, a)).toMatchObject({ version: 0, createKey: body.createKey });
  });

  it('replays a turn receipt across params key order and later progress; changed content conflicts', async () => {
    const cookie = await session();
    const initial = await start(cookie);
    const body = input(initial, 'hold_photos', { target: 'guests', channel: 'screen', text: '先留在照片' }, 'same-turn');
    const first = await json<PlayerView>(post(`${branchPath(initial)}/turns`, cookie, body));
    const later = await turn(cookie, first, 'watch_table');
    await unchanged(cookie, later, async () => {
      expect(await json(post(`${branchPath(initial)}/turns`, cookie, {
        ...body, params: { text: '先留在照片', channel: 'screen', target: 'guests' },
      }))).toEqual(first);
      for (const changed of [{ ...body, actionId: 'play_intro' }, { ...body, expectedRevision: later.revision },
        { ...body, params: { ...body.params, text: '换一句' } }]) {
        await rejected(post(`${branchPath(initial)}/turns`, cookie, changed), 409, 'VERSION_CONFLICT');
      }
      await rejected(post(`${branchPath(initial)}/turns`, cookie, { ...body, requestId: 'new-but-stale' }), 409);
    });
  });

  it.each([false, true])('same-revision Promise.all (duplicate request: %s) commits exactly once', async duplicate => {
    const cookie = await session();
    const initial = await start(cookie);
    const body = input(initial, 'hold_photos', {}, 'race-a');
    const other = duplicate ? body : input(initial, 'play_intro', {}, 'race-b');
    const responses = await Promise.all([post(`${branchPath(initial)}/turns`, cookie, body), post(`${branchPath(initial)}/turns`, cookie, other)]);
    expect(responses.map(response => response.status).sort()).toEqual(duplicate ? [200, 200] : [200, 409]);
    const results = await Promise.all(responses.map(response => response.json()));
    if (duplicate) expect(results[0]).toEqual(results[1]);
    else expect(results[responses.findIndex(response => response.status === 409)].code).toBe('VERSION_CONFLICT');
    const view = await json<PlayerView>(request(branchPath(initial), cookie));
    const saved = await record(cookie, view);
    expect(saved.version).toBe(1);
    expect(view.revision).toBe(1);
    expect(view.checkpoints).toHaveLength(1);
    expect(Object.keys(saved.document.runs[view.runId].branches[view.branchId].requests)).toHaveLength(1);
    expect(view.visibleEvents.slice(initial.visibleEvents.length).filter(event => event.kind === 'player_action')).toHaveLength(1);
    expect(view).toEqual(results[responses.findIndex(response => response.status === 200)]);
    authoredProjection(view);
  });

  it('reads, polls, cursor resets and completed fallback never write or regenerate events', async () => {
    const cookie = await session();
    const initial = await start(cookie);
    const first = await turn(cookie, initial, 'hold_photos', {}, 'first');
    const ended = await turn(cookie, await turn(cookie, first, 'watch_table'), 'offer_mic', {}, 'last');
    await unchanged(cookie, ended, async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(await json(request(branchPath(ended), cookie, { origin: null }))).toEqual(ended);
        for (const [id, expected] of [['first', first], ['last', ended]] as const) {
          expect(await json(request(`${branchPath(ended)}/turns/${id}`, cookie))).toEqual(expected);
          expect(await json(post(`${branchPath(ended)}/turns/${id}/fallback`, cookie, {}))).toEqual(expected);
        }
      }
      const cursor = first.visibleEvents.at(-1)!.eventId;
      expect(await json(request(`${branchPath(ended)}?afterEventId=${cursor}`, cookie))).toEqual({
        ...ended, visibleEvents: ended.visibleEvents.slice(first.visibleEvents.length), reset: false,
      });
      expect(await json(request(`${branchPath(ended)}?afterEventId=${ended.visibleEvents.at(-1)!.eventId}`, cookie))).toEqual({ ...ended, visibleEvents: [], reset: false });
      expect(await json(request(`${branchPath(ended)}?afterEventId=unknown`, cookie))).toEqual({ ...ended, reset: true });
      await rejected(request(`${branchPath(ended)}/turns/unknown`, cookie), 404, 'NOT_FOUND');
      await rejected(post(`${branchPath(ended)}/turns/unknown/fallback`, cookie, {}), 404, 'NOT_FOUND');
    });
  });
});

describe('rewind and server-authoritative actions', () => {
  it('forks idempotently, rejects changed checkpoints and cannot inherit future wedding consent or receipts', async () => {
    const cookie = await session();
    const second = await turn(cookie, await start(cookie), 'preview_tail');
    const third = await turn(cookie, second, 'private_preview', {}, 'consent');
    const ended = await turn(cookie, third, 'lend_laptop', {}, 'ending');
    const originalBranch = (await record(cookie, ended)).document.runs[ended.runId].branches[ended.branchId];
    const forkBody = { checkpointId: ended.checkpoints[1].id, forkKey: 'rewind' };
    const rewind = await json<PlayerView>(post(`${branchPath(ended)}/forks`, cookie, forkBody), 201);
    expect(rewind.branchId).not.toBe(ended.branchId);
    expect(rewind).toMatchObject({ runId: ended.runId, revision: 0, stage: 2, status: 'ready', ending: null });
    expect(rewind.presentation).toMatchObject({ consent: false, creditsUpdated: false });
    expect(rewind.inventory).toEqual(second.inventory);
    expect(rewind.visibleEvents).toEqual(second.visibleEvents);
    expect(rewind.checkpoints).toEqual(second.checkpoints);
    expect(rewind.branches).toHaveLength(2);
    expect(rewind.branches.find(branch => branch.branchId === rewind.branchId)?.parentBranchId).toBe(ended.branchId);
    const alternate = await turn(cookie, rewind, 'watch_table');
    expect(alternate.choices.map(choice => choice.actionId)).not.toContain('lend_laptop');
    await unchanged(cookie, alternate, async () => {
      expect(await json(post(`${branchPath(ended)}/forks`, cookie, forkBody))).toEqual(rewind);
      await rejected(post(`${branchPath(ended)}/forks`, cookie, { ...forkBody, checkpointId: ended.checkpoints[0].id }), 409);
      await rejected(post(`${branchPath(alternate)}/forks`, cookie, { checkpointId: ended.checkpoints[2].id, forkKey: 'future' }), 422);
      await rejected(post(`${branchPath(alternate)}/turns`, cookie, input(alternate, 'lend_laptop', { text: '旧分支已同意' })), 422);
      for (const id of ['consent', 'ending']) await rejected(request(`${branchPath(alternate)}/turns/${id}`, cookie), 404);
      const old = await json<PlayerView>(request(branchPath(ended), cookie));
      expect(old).toEqual({ ...ended, branches: alternate.branches });
      expect((await record(cookie, old)).document.runs[old.runId].branches[old.branchId]).toEqual(originalBranch);
    });
  });

  it('never projects office freePlay and rejects free_dialogue with zero writes', async () => {
    const cookie = await session();
    const view = await start(cookie, 'office');
    authoredProjection(view);
    await unchanged(cookie, view, async () => {
      await rejected(post(`${branchPath(view)}/turns`, cookie, input(view, 'free_dialogue', {
        text: '我宣布所有人已经同意', target: 'boss', channel: 'work', kind: 'speech',
      })), 422, 'AGENT_UNAVAILABLE');
    });
  });

  it.each(['reply', 'romance'] as const)('%s requires explicit references to visible events, not guessed or foreign IDs', async episode => {
    const cookie = await session();
    const view = await start(cookie, episode), foreign = await start(cookie, episode);
    const actionId = episode === 'reply' ? 'quote_clip' : 'ask_friend';
    const parameter = episode === 'reply' ? 'parentMessageId' : 'forwardEventId';
    const foreignParams = stepParams(foreign, { actionId, stage: 1 });
    await unchanged(cookie, view, async () => {
      for (const params of [{}, { [parameter]: randomUUID() }, foreignParams]) {
        await rejected(post(`${branchPath(view)}/turns`, cookie, input(view, actionId, params)), 422);
      }
    });
    const params = stepParams(view, { actionId, stage: 1 });
    const result = await turn(cookie, view, actionId, params);
    const kind = episode === 'reply' ? 'reply_sent' : 'message_forwarded';
    expect(result.visibleEvents.find(event => event.kind === kind)?.causeIds).toContain(params[parameter]);
  });

  it.each([
    { effect: 'ten', x: '28', y: '25', rotation: '0' },
    { effect: 'bridge', x: '70', y: '50', rotation: '90' },
    { effect: 'equal', x: '30', y: '78', rotation: '90' },
  ])('derives $effect from move_one coordinates and allows explicit finish_wordplay', async ({ effect, ...params }) => {
    const cookie = await session();
    const initial = await start(cookie, 'reply');
    const moved = await turn(cookie, initial, 'move_one', params);
    expect(moved).toMatchObject({ revision: 1, stage: 1, status: 'ready', ending: null,
      wordPlay: { x: Number(params.x), y: Number(params.y), rotation: Number(params.rotation), effect, discovered: [effect] } });
    expect(moved.visibleEvents.slice(initial.visibleEvents.length).map(event => event.kind)).toEqual(['word_moved', 'word_effect', 'dialogue']);
    const finished = await turn(cookie, moved, 'finish_wordplay');
    expect(finished).toMatchObject({ revision: 2, status: 'ended', ending: { id: 'reply.wordplay' } });
    expect(finished.wordPlay).toEqual(moved.wordPlay);
    expect(finished.inventory).toEqual(initial.inventory);
    expect(await json(request(branchPath(finished), cookie))).toEqual(finished);
    authoredProjection(finished);
    await unchanged(cookie, finished, async () => {
      await rejected(post(`${branchPath(finished)}/turns`, cookie, input(finished, 'move_one', params)), 422);
    });
  });

  it('rejects forged word effects, invalid bounds/rotation and premature finish with zero writes', async () => {
    const cookie = await session();
    const view = await start(cookie, 'reply');
    const pose = { x: '28', y: '25', rotation: '0' };
    await unchanged(cookie, view, async () => {
      const invalidPoses: Params[] = [
        { ...pose, effect: 'equal' }, { ...pose, x: '4.99' }, { ...pose, x: '95.01' },
        { ...pose, y: '4.99' }, { ...pose, y: '95.01' }, { ...pose, x: 'NaN' },
        { ...pose, x: 'Infinity' }, { ...pose, rotation: '45' }, { x: '28', y: '25' },
        { x: '50', y: '90', rotation: '0' },
      ];
      for (const params of invalidPoses) await rejected(post(`${branchPath(view)}/turns`, cookie, input(view, 'move_one', params)), 422);
      const invalidFinishes: Params[] = [{}, { effect: 'ten' }];
      for (const params of invalidFinishes) await rejected(post(`${branchPath(view)}/turns`, cookie, input(view, 'finish_wordplay', params)), 422);
    });
    const moved = await turn(cookie, view, 'move_one', pose);
    await unchanged(cookie, moved, async () => {
      await rejected(post(`${branchPath(moved)}/turns`, cookie, input(moved, 'finish_wordplay', { effect: 'equal' })), 422);
    });
    const office = await start(cookie, 'office');
    await unchanged(cookie, office, async () => {
      for (const actionId of ['move_one', 'finish_wordplay']) await rejected(post(`${branchPath(office)}/turns`, cookie, input(office, actionId, actionId === 'move_one' ? pose : {})), 422);
    });
  });
});

describe('unknown write outcomes and bounded saves', () => {
  it('does not redispatch an uncertain create and recovers the original receipt on explicit retry', async () => {
    const cookie = await session();
    const body = { episodeId: 'wedding', createKey: 'lost-create' };
    const insert = repository.insertRun.bind(repository);
    const write = vi.spyOn(repository, 'insertRun').mockImplementationOnce(async value => {
      await insert(value);
      throw new Error('provider-private: response lost after commit');
    });
    await rejected(post('/api/runs', cookie, body), 503, 'SERVICE_UNAVAILABLE');
    expect(write).toHaveBeenCalledTimes(1);
    const saved = await repository.findCreatedRun(hash(tokenOf(cookie)), body.createKey);
    expect(saved).not.toBeNull();
    const initial = Object.values(saved!.document.createKeys)[0].result;
    const recovered = await json<PlayerView>(post('/api/runs', cookie, body));
    expect(recovered).toMatchObject({ runId: initial.runId, branchId: initial.branchId, revision: 0 });
    expect(recovered.visibleEvents).toEqual(initial.visibleEvents);
    expect(await record(cookie, recovered)).toEqual(saved);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it.each(['turn', 'fork'] as const)('recovers a committed %s after a lost database response without duplicate writes', async operation => {
    const cookie = await session();
    const view = await turn(cookie, await start(cookie), 'hold_photos');
    const path = `${branchPath(view)}/${operation === 'turn' ? 'turns' : 'forks'}`;
    const body = operation === 'turn' ? input(view, 'watch_table', {}, 'lost-turn')
      : { checkpointId: view.checkpoints[0].id, forkKey: 'lost-fork' };
    const compare = repository.compareAndSetRun.bind(repository);
    const write = vi.spyOn(repository, 'compareAndSetRun').mockImplementationOnce(async (value, version) => {
      await compare(value, version);
      throw new Error('provider-private: response lost after commit');
    });
    await rejected(post(path, cookie, body), 503, 'SERVICE_UNAVAILABLE');
    expect(write).toHaveBeenCalledTimes(1);
    const saved = await record(cookie, view);
    expect(saved.version).toBe(2);
    const recovered = await json<PlayerView>(post(path, cookie, body));
    expect(await record(cookie, recovered)).toEqual(saved);
    expect(write).toHaveBeenCalledTimes(1);
    expect(recovered.revision).toBe(operation === 'turn' ? 2 : 0);
    if (operation === 'turn') expect(await json(request(`${branchPath(view)}/turns/lost-turn`, cookie))).toEqual(recovered);
    else expect(recovered.branches).toHaveLength(2);
  });

  it('caps branch growth while preserving reads and idempotent fork receipts', async () => {
    const cookie = await session();
    const view = await turn(cookie, await start(cookie), 'hold_photos');
    const path = `${branchPath(view)}/forks`;
    const body = { checkpointId: view.checkpoints[0].id, forkKey: 'fork-0' };
    const first = await json<PlayerView>(post(path, cookie, body), 201);
    for (let index = 1; index < 15; index++) await json(post(path, cookie, { ...body, forkKey: `fork-${index}` }), 201);
    const saved = await json<PlayerView>(request(branchPath(view), cookie));
    expect(saved.branches).toHaveLength(16);
    await unchanged(cookie, view, async () => {
      await rejected(post(path, cookie, { ...body, forkKey: 'overflow' }), 429, 'SAVE_LIMIT');
      expect(await json(post(path, cookie, body))).toEqual(first);
      expect(await json(request(branchPath(view), cookie))).toEqual(saved);
    });
  });

  it.each(['turn count', 'document bytes'] as const)('rejects %s overflow without partially saving the action', async limit => {
    const cookie = await session();
    const view = await turn(cookie, await start(cookie), 'hold_photos', {}, 'seed');
    const saved = await record(cookie, view);
    const branch = saved.document.runs[view.runId].branches[view.branchId];
    if (limit === 'turn count') {
      for (let index = 1; index < 64; index++) branch.requests[JSON.stringify(`seed-${index}`)] = structuredClone(branch.requests[JSON.stringify('seed')]);
    } else branch.state.scene.text = '界'.repeat(720_000);
    expect(await repository.compareAndSetRun({ ...saved, version: saved.version + 1 }, saved.version)).toBe(true);
    await unchanged(cookie, view, async () => {
      await rejected(post(`${branchPath(view)}/turns`, cookie, input(view, 'watch_table')), 429, 'SAVE_LIMIT');
      const restored = await json<PlayerView>(request(branchPath(view), cookie));
      expect(restored.revision).toBe(view.revision);
      expect(restored.visibleEvents).toEqual(view.visibleEvents);
    });
  });

  it('refuses unsupported saved scripts rather than rewriting them using current rules', async () => {
    const cookie = await session();
    const view = await start(cookie);
    const saved = await record(cookie, view);
    saved.document.runs[view.runId].scriptVersion = 'unsupported';
    expect(await repository.compareAndSetRun({ ...saved, version: saved.version + 1 }, saved.version)).toBe(true);
    await unchanged(cookie, view, async () => {
      await rejected(request(branchPath(view), cookie), 503, 'SCRIPT_UNAVAILABLE');
      await rejected(post(`${branchPath(view)}/turns`, cookie, input(view, 'hold_photos')), 503, 'SCRIPT_UNAVAILABLE');
      await rejected(post('/api/runs', cookie, { episodeId: 'wedding', createKey: saved.createKey }), 503, 'SCRIPT_UNAVAILABLE');
    });
  });
});

describe('HTTP input boundaries', () => {
  it.each<{ name: string; options: HttpOptions; status: number }>([
    { name: 'foreign Origin', options: { origin: 'https://attacker.test' }, status: 403 },
    { name: 'missing Origin', options: { origin: null }, status: 403 },
    { name: 'opaque Origin', options: { origin: 'null' }, status: 403 },
    { name: 'cross-site fetch metadata', options: { headers: { 'Sec-Fetch-Site': 'cross-site' } }, status: 403 },
    { name: 'bad JSON', options: { raw: '{' }, status: 400 },
    { name: 'non-object JSON', options: { raw: '[]' }, status: 400 },
    { name: 'wrong content type', options: { headers: { 'Content-Type': 'text/plain' } }, status: 400 },
    { name: 'over 8 KB of UTF-8 (under 8 K characters)', options: { raw: JSON.stringify({ text: '界'.repeat(3000) }) }, status: 413 },
  ])('rejects $name without touching SQLite state', async ({ options, status }) => {
    const cookie = await session();
    const view = await start(cookie);
    await unchanged(cookie, view, async () => {
      await rejected(request(`${branchPath(view)}/turns`, cookie, { method: 'POST', body: input(view, 'hold_photos'), ...options }), status);
    });
  });

  it('rejects GET on every write route, unknown routes, fields and invalid input without writes', async () => {
    const cookie = await session();
    const view = await turn(cookie, await start(cookie), 'hold_photos', {}, 'receipt');
    const path = branchPath(view), body = input(view, 'watch_table');
    await unchanged(cookie, view, async () => {
      for (const route of ['/api/session', '/api/runs', `${path}/turns`, `${path}/forks`, `${path}/turns/receipt/fallback`]) {
        const response = await request(route, cookie);
        expect(response.headers.get('allow')).toBe('POST');
        await rejected(Promise.resolve(response), 405, 'METHOD_NOT_ALLOWED');
      }
      for (const route of ['/api/unknown', `${path}/unknown`, `${path}/forks/unknown`]) await rejected(post(route, cookie, {}), 404, 'NOT_FOUND');
      await rejected(request('/api/episodes', '', { prefix: '' }), 404);
      await rejected(request(`${path}?unknown=value`, cookie), 400);
      await rejected(post(`${path}/turns?afterEventId=unknown`, cookie, body), 400);
      await rejected(request(`${path}/turns`, cookie, { method: 'POST' }), 400);
      await rejected(post('/api/runs', cookie, { episodeId: 'not-an-episode', createKey: 'invalid' }), 400);
      await rejected(post(`${path}/turns/receipt/fallback`, cookie, { extra: true }), 400);
      for (const invalid of [{ ...body, extra: true }, { ...body, requestId: '' }, { ...body, expectedRevision: -1 },
        { ...body, expectedRevision: Number.MAX_SAFE_INTEGER + 1 }, { ...body, stage: 4 },
        { ...body, params: { text: 1 } }, { ...body, params: [] }]) {
        await rejected(post(`${path}/turns`, cookie, invalid), 400, 'INVALID_INPUT');
      }
      await rejected(post(`${path}/turns`, cookie, { ...body, params: { unknown: 'field' } }), 422);
      await rejected(post(`${path}/turns`, cookie, { ...body, actionId: 'not-an-action' }), 422);
    });
  });
});
