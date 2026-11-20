import { readFile } from 'node:fs/promises';
import { expect, test as base, type Page, type Route } from '@playwright/test';
import { episodes } from '../../content/episodes';
import { createRun, emptyStore, submitTurn, type AuthoredStore } from '../../fixtures/authored-engine';
import type { PlayerView, TurnInput, WordPlay } from '../../shared/contracts';

const test = base.extend<{ diagnostics: void }>({
  diagnostics: [async ({ page }, use, testInfo) => {
    const errors: string[] = [];
    const consoleMessages: { type: string; text: string }[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => consoleMessages.push({ type: message.type(), text: message.text() }));
    await use();
    await testInfo.attach('browser-diagnostics', {
      body: JSON.stringify({ pageErrors: errors, console: consoleMessages }, null, 2),
      contentType: 'application/json',
    });
    // A mocked 503 may log a resource error, but must never cause an uncaught page error.
    expect(errors).toEqual([]);
  }, { auto: true }],
});

type Pose = Pick<WordPlay, 'x' | 'y' | 'rotation'>;
type Branch = AuthoredStore['runs'][string]['branches'][string];
const names = { ten: '10 人签到', bridge: '横过来挡拆', equal: '原题恢复' };
const initialPose: Pose = { x: 50, y: 90, rotation: 0 };
const rawSave = (page: Page) => page.evaluate(() => localStorage.getItem('retake.authored.v1'));

async function savedBranch(page: Page, branchId?: string): Promise<Branch> {
  return page.evaluate(id => {
    const [, runId, currentBranch] = location.hash.replace(/^#\/?/, '').split('/');
    return JSON.parse(localStorage.getItem('retake.authored.v1')!).store.runs[runId].branches[id ?? currentBranch];
  }, branchId);
}

async function openAuthored(page: Page) {
  await page.goto('/#/episode/reply');
  await expect(page).toHaveURL(/#\/play\/[^/]+\/[^/]+$/);
  await expect(page.locator('.word-token')).toBeEnabled();
  await expect(page.getByRole('group', { name: '自由移动数字 1 的留言板' })).toHaveCount(1);
  await expect(page.locator('.word-rotate')).toBeInViewport();
  expect((await savedBranch(page)).state.wordPlay).toEqual({ ...initialPose, effect: 'none', discovered: [] });
}

async function draftPose(page: Page): Promise<Pose> {
  return page.locator('.word-token').evaluate((element): Pose => {
    const token = element as HTMLButtonElement;
    const glyph = token.querySelector<SVGElement>('.word-glyph')!;
    return { x: parseFloat(token.style.left), y: parseFloat(token.style.top), rotation: glyph.style.transform === 'rotate(90deg)' ? 90 : 0 };
  });
}

async function expectPose(page: Page, pose: Pose, dirty = false) {
  await expect.poll(() => draftPose(page)).toEqual({ x: pose.x, y: pose.y, rotation: pose.rotation });
  await expect(page.locator('.word-token')).toHaveAccessibleName(`数字 1，横坐标 ${pose.x}，纵坐标 ${pose.y}，${pose.rotation === 0 ? '竖直' : '横向'}，${dirty ? '尚未落位' : '已落位'}`);
}

async function expectEffect(page: Page, effect: WordPlay['effect'], discovered: WordPlay['discovered']) {
  await expect(page.locator('.word-board')).toHaveAttribute('data-effect', effect);
  await expect(page.locator('.word-signature')).toHaveCount(effect === 'ten' ? 1 : 0);
  await expect(page.locator('.word-rerouting')).toHaveCount(effect === 'bridge' ? 9 : 0);
  await expect(page.locator('.word-ball-blocked')).toHaveCount(effect === 'bridge' ? 1 : 0);
  await expect(page.locator('.word-typing-avatar')).toHaveCount(effect === 'equal' ? 37 : 0);
  await expect(page.locator('.word-discoveries li[data-found="true"]')).toHaveCount(discovered.length);
  for (const id of ['ten', 'bridge', 'equal'] as const) {
    await expect(page.locator('.word-discoveries li').filter({ hasText: names[id] })).toHaveAttribute('data-found', String(discovered.includes(id)));
  }
}

async function scrollBoard(page: Page) {
  const board = page.locator('.word-board');
  // Check ancestor clipping as well as the viewport.
  await board.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
  await expect.poll(() => board.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const clips = [element.closest('.word-workbench')!, element.closest('.stage-column')!].map(ancestor => ancestor.getBoundingClientRect());
    return rect.top >= Math.max(0, ...clips.map(clip => clip.top))
      && rect.bottom <= Math.min(innerHeight, ...clips.map(clip => clip.bottom))
      && rect.left >= Math.max(0, ...clips.map(clip => clip.left))
      && rect.right <= Math.min(innerWidth, ...clips.map(clip => clip.right));
  })).toBe(true);
}

async function dragPoints(page: Page, x: number, y: number) {
  await scrollBoard(page);
  const board = (await page.locator('.word-board').boundingBox())!;
  const token = (await page.locator('.word-token').boundingBox())!;
  const start = { x: token.x + token.width / 2, y: token.y + token.height / 2 };
  const end = { x: board.x + board.width * x / 100, y: board.y + board.height * y / 100 };
  expect(await page.evaluate(point => Boolean(document.elementFromPoint(point.x, point.y)?.closest('.word-token')), start)).toBe(true);
  expect(await page.evaluate(point => Boolean(document.elementFromPoint(point.x, point.y)?.closest('.word-board')), end)).toBe(true);
  return { start, end };
}

async function mouseDraft(page: Page, x: number, y: number) {
  const { start, end } = await dragPoints(page, x, y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await expect(page.locator('.word-board')).toHaveAttribute('data-dragging', 'true');
  const pose = await draftPose(page);
  // Native input may round fractional CSS pixels; never require snapping to a zone center.
  expect(pose.x).toBeCloseTo(x, 0);
  expect(pose.y).toBeCloseTo(y, 0);
  return pose;
}

async function expectMove(page: Page, before: Branch, pose: Pose, effect: WordPlay['effect'], discovered: WordPlay['discovered']) {
  await expect.poll(async () => (await savedBranch(page)).state.revision).toBe(before.state.revision + 1);
  await expect(page.locator('.word-token')).toBeEnabled();
  const after = await savedBranch(page);
  expect(after.state).toMatchObject({ stage: before.state.stage, status: 'ready', ending: null, wordPlay: { ...pose, effect, discovered } });
  expect(after.state.choices).toEqual(before.state.choices);
  expect(after.checkpoints).toHaveLength(before.checkpoints.length + 1);
  expect(after.checkpoints.at(-1)!.state).toEqual(before.state);
  const newRequests = Object.keys(after.requests).filter(key => !Object.hasOwn(before.requests, key));
  expect(newRequests).toHaveLength(1);
  expect(JSON.parse(after.requests[newRequests[0]].fingerprint)).toMatchObject({
    actionId: 'move_one', stage: before.state.stage, expectedRevision: before.state.revision,
    params: { x: String(pose.x), y: String(pose.y), rotation: String(pose.rotation) },
  });
  const added = after.state.visibleEvents.slice(before.state.visibleEvents.length);
  expect(added.filter(event => event.kind === 'word_moved')).toHaveLength(1);
  expect(added.every(event => event.source !== 'live')).toBe(true);
  await expectPose(page, pose);
  await expectEffect(page, effect, discovered);
  await expect(page.locator('.ending-panel')).toHaveCount(0);
  return after;
}

async function moveMouse(page: Page, pose: Pose, effect: WordPlay['effect'], discovered: WordPlay['discovered']) {
  const before = await savedBranch(page);
  const saved = await rawSave(page);
  if ((await draftPose(page)).rotation !== pose.rotation) await page.locator('.word-rotate').click();
  const actual = await mouseDraft(page, pose.x, pose.y);
  await expectPose(page, actual, true);
  await expect(page.locator('.word-board')).toHaveAttribute('data-effect', before.state.wordPlay!.effect);
  if (before.state.wordPlay!.effect !== 'none') await expect(page.locator('.word-finish')).toBeDisabled();
  expect(await rawSave(page)).toBe(saved); // Pointer moves and rotation are drafts, not turns.
  await page.mouse.up();
  return expectMove(page, before, actual, effect, discovered);
}

async function finishWordplay(page: Page, before: Branch) {
  await page.locator('.word-finish').click();
  await expect.poll(async () => (await savedBranch(page)).state.revision).toBe(before.state.revision + 1);
  await expect(page.locator('.ending-panel')).toBeVisible();
  const after = await savedBranch(page);
  expect(after.state).toMatchObject({ status: 'ended', stage: before.state.stage, ending: { id: 'reply.wordplay' }, wordPlay: before.state.wordPlay });
  expect(after.state.visibleEvents.filter(event => event.kind === 'wordplay_finished')).toHaveLength(1);
  expect(after.checkpoints).toHaveLength(before.checkpoints.length + 1);
  const requests = Object.keys(after.requests).filter(key => !Object.hasOwn(before.requests, key));
  expect(requests).toHaveLength(1);
  expect(JSON.parse(after.requests[requests[0]].fingerprint)).toMatchObject({ actionId: 'finish_wordplay', params: {} });
  await expect(page.locator('.word-token')).toBeDisabled();
  await expect(page.locator('.word-finish')).toHaveCount(0);
  return after;
}

test('文字摆放：鼠标自由落位、三种画面与解除可持久化，主动谢幕后下载真实 PNG', async ({ page }, testInfo) => {
  await openAuthored(page);
  await expect(page.locator('.word-finish')).toHaveCount(0);
  await moveMouse(page, { x: 82, y: 16, rotation: 0 }, 'none', []);
  await moveMouse(page, { x: 28, y: 25, rotation: 0 }, 'ten', ['ten']);
  await moveMouse(page, { x: 70, y: 50, rotation: 90 }, 'bridge', ['ten', 'bridge']);
  await moveMouse(page, { x: 30, y: 78, rotation: 90 }, 'equal', ['ten', 'bridge', 'equal']);
  const reversed = await moveMouse(page, { x: 82, y: 16, rotation: 90 }, 'none', ['ten', 'bridge', 'equal']);
  expect(reversed.state.visibleEvents.filter(event => event.kind === 'word_effect').at(-1)!.text).toContain('已解除');
  await expect(page.locator('.word-finish')).toHaveCount(0);
  const current = await moveMouse(page, { x: 30, y: 78, rotation: 90 }, 'equal', ['ten', 'bridge', 'equal']);
  await page.reload();
  await expect(page.locator('.word-token')).toBeEnabled();
  expect(await savedBranch(page)).toEqual(current);
  await expectPose(page, current.state.wordPlay!);
  await expectEffect(page, 'equal', ['ten', 'bridge', 'equal']);
  await scrollBoard(page);
  expect(await page.locator('.stage-column').evaluate(element => element.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('wordplay-three-discoveries.png') });

  const ended = await finishWordplay(page, current);
  await expect(page.locator('.scene-title .last-line')).toHaveText(`“${ended.state.ending!.line}”`);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存这张剧照' }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('这集我来演-reply.wordplay.png');
  expect(await download.failure()).toBeNull();
  const imagePath = testInfo.outputPath('wordplay-cover.png');
  await download.saveAs(imagePath);
  const png = await readFile(imagePath);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(await page.evaluate(async source => {
    const image = new Image();
    image.src = source;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, `data:image/png;base64,${png.toString('base64')}`)).toEqual({ width: 900, height: 1200 });
  await page.reload();
  await expect(page.locator('.ending-panel')).toBeVisible();
  expect(await savedBranch(page)).toEqual(ended);
});

test('文字摆放：键盘微调和快移只改草稿，Esc/按钮撤回，Enter/Space落位且同姿势不重复写入', async ({ page }) => {
  await openAuthored(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const token = page.locator('.word-token');
  const opening = await savedBranch(page);
  const saved = await rawSave(page);
  await token.press('ArrowLeft');
  await token.press('Shift+ArrowUp');
  await token.press('r');
  await expectPose(page, { x: 48, y: 80, rotation: 90 }, true);
  await expect(page.locator('.word-preview')).toContainText('未提交');
  expect(await rawSave(page)).toBe(saved);
  await token.press('Escape');
  await expectPose(page, initialPose);
  expect(await rawSave(page)).toBe(saved);
  await token.press('ArrowRight');
  await page.locator('.word-cancel').click();
  await expectPose(page, initialPose);
  await expect(page.locator('.word-confirm')).toBeDisabled();
  expect(await rawSave(page)).toBe(saved);

  await token.press('r');
  await token.press('Enter');
  const rotated = await expectMove(page, opening, { ...initialPose, rotation: 90 }, 'none', []);
  await token.press('Shift+ArrowLeft');
  await token.press('Shift+ArrowLeft');
  await token.press('Shift+ArrowUp');
  await token.press('ArrowUp');
  await expectPose(page, { x: 30, y: 78, rotation: 90 }, true);
  await expect(page.locator('.word-preview')).toContainText('原题恢复');
  await expectEffect(page, 'none', []);
  await token.press('Space');
  await expectMove(page, rotated, { x: 30, y: 78, rotation: 90 }, 'equal', ['equal']);
  const settled = await rawSave(page);
  await token.press('r');
  await expect(page.locator('.word-finish')).toBeDisabled();
  await token.press('r');
  await token.press('Enter');
  await token.press('Space');
  await expect(page.locator('.word-token')).toBeEnabled();
  await expect(page.locator('.word-confirm')).toBeDisabled();
  await expect(page.locator('.word-cancel')).toBeDisabled();
  expect(await rawSave(page)).toBe(settled);
});

test.describe('文字摆放：浏览器触屏模拟', () => {
  test.use({ hasTouch: true });
  test('CDP拖动松手只提交一次，touchCancel撤回且刷新保留已落位姿势', async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'CDP Input.dispatchTouchEvent requires Chromium');
    await openAuthored(page);
    expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
    const cdp = await page.context().newCDPSession(page);
    try {
      const before = await savedBranch(page);
      const saved = await rawSave(page);
      const { start, end } = await dragPoints(page, 28, 25);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...end, id: 1 }] });
      await expect(page.locator('.word-board')).toHaveAttribute('data-dragging', 'true');
      const pose = await draftPose(page);
      expect(pose.x).toBeCloseTo(28, 0);
      expect(pose.y).toBeCloseTo(25, 0);
      expect(await rawSave(page)).toBe(saved);
      await expectEffect(page, 'none', []);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const accepted = await expectMove(page, before, pose, 'ten', ['ten']);
      const settled = await rawSave(page);
      const cancel = await dragPoints(page, 82, 16);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...cancel.start, id: 2 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...cancel.end, id: 2 }] });
      await expect(page.locator('.word-board')).toHaveAttribute('data-dragging', 'true');
      await expect(page.locator('.word-preview')).toContainText('自由落位');
      expect(await rawSave(page)).toBe(settled);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await expect(page.locator('.word-board')).toHaveAttribute('data-dragging', 'false');
      await expectPose(page, pose);
      await expectEffect(page, 'ten', ['ten']);
      expect(await rawSave(page)).toBe(settled);
      await page.reload();
      await expect(page.locator('.word-token')).toBeEnabled();
      expect(await savedBranch(page)).toEqual(accepted);
      await scrollBoard(page);
      await page.screenshot({ path: testInfo.outputPath('wordplay-touch-cancel.png') });
    } finally {
      await cdp.detach();
    }
  });
});

test('文字摆放：倒带恢复该检查点的姿势和发现，分支草稿隔离且旧结局原文不变', async ({ page }) => {
  await openAuthored(page);
  const ten = await moveMouse(page, { x: 28, y: 25, rotation: 0 }, 'ten', ['ten']);
  const bridge = await moveMouse(page, { x: 70, y: 50, rotation: 90 }, 'bridge', ['ten', 'bridge']);
  const old = await finishWordplay(page, bridge);
  const oldRoute = page.url();
  await page.getByRole('button', { name: '倒回去，换个演法' }).click();
  // Each move adds a checkpoint despite remaining at stage 1; the second precedes bridge.
  await page.locator('.rewind-list').first().getByRole('button').nth(1).click();
  await expect.poll(async () => (await savedBranch(page)).state.branchId).not.toBe(old.state.branchId);
  await expect(page.locator('.word-token')).toBeEnabled();
  const fork = await savedBranch(page);
  expect(fork.parentBranchId).toBe(old.state.branchId);
  expect(fork.state).toMatchObject({ revision: 0, stage: 1, status: 'ready', wordPlay: ten.state.wordPlay });
  expect(fork.state.visibleEvents).toEqual(ten.state.visibleEvents);
  expect(fork.checkpoints).toHaveLength(1);
  expect(fork.requests).toEqual({});
  await expectPose(page, ten.state.wordPlay!);
  await expectEffect(page, 'ten', ['ten']);
  await moveMouse(page, { x: 30, y: 78, rotation: 90 }, 'equal', ['ten', 'equal']);
  expect(await savedBranch(page, old.state.branchId)).toEqual(old);
  const forkRoute = page.url();
  const persistedFork = await savedBranch(page);
  const saved = await rawSave(page);
  await page.locator('.word-token').press('ArrowRight');
  await expect(page.locator('.word-preview')).toContainText('未提交');
  await page.getByRole('button', { name: '倒带', exact: true }).click();
  await page.locator('.rewind-list').nth(1).getByRole('button', { name: new RegExp(old.state.ending!.title) }).click();
  await expect(page).toHaveURL(oldRoute);
  await expect(page.locator('.ending-panel')).toBeVisible();
  await expectPose(page, old.state.wordPlay!);
  await expectEffect(page, 'bridge', ['ten', 'bridge']);
  await expect(page.locator('.dialogue-line p')).toHaveText(old.state.visibleEvents.filter(event => event.audience.includes('player')).map(event => event.text));
  expect(await savedBranch(page)).toEqual(old);
  expect(await rawSave(page)).toBe(saved);
  await page.goto(forkRoute);
  await expect(page.locator('.word-token')).toBeEnabled();
  await expectPose(page, persistedFork.state.wordPlay!);
  await expectEffect(page, 'equal', ['ten', 'equal']);
  expect(await savedBranch(page)).toEqual(persistedFork);
});

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

// These routes are deliberately local HTTP mocks, not cloud/NPC acceptance evidence.
async function installSiteMock(page: Page, initial: PlayerView, current: () => PlayerView,
  turn: (route: Route, input: TurnInput, attempt: number) => Promise<void>,
  poll?: (route: Route) => Promise<void>) {
  const inputs: TurnInput[] = [];
  const pollPaths: string[] = [];
  const unexpected: string[] = [];
  const root = '/functions/v1/app/api';
  const branch = `${root}/runs/${initial.runId}/branches/${initial.branchId}`;
  await page.route('**/functions/v1/app/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && path === `${root}/episodes`) return route.fulfill({ json: episodes });
    if (request.method() === 'POST' && path === `${root}/runs`) return route.fulfill({ json: initial });
    if (request.method() === 'GET' && path === branch) return route.fulfill({ json: current() });
    if (request.method() === 'POST' && path === `${branch}/turns`) {
      const input = request.postDataJSON() as TurnInput;
      inputs.push(input);
      return turn(route, input, inputs.length);
    }
    if (request.method() === 'GET' && path === `${branch}/turns/${inputs[0]?.requestId}` && poll) {
      pollPaths.push(path);
      return poll(route);
    }
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 500, json: { code: 'UNEXPECTED_MOCK_REQUEST', retryable: false } });
  });
  return { inputs, pollPaths, unexpected };
}

async function expectLockedDraft(page: Page, pose: Pose, preview: string) {
  await expect(page.locator('.word-token')).toBeDisabled();
  for (const selector of ['.word-rotate', '.word-confirm', '.word-cancel', '.word-nudge']) {
    for (const button of await page.locator(selector).all()) await expect(button).toBeDisabled();
  }
  await expectPose(page, pose, true);
  await expect(page.locator('.word-preview')).toContainText(preview);
  await expect(page.locator('.word-board-state')).toHaveText('等待确认 · 位置已保留');
  await expectEffect(page, 'none', []);
  await expect(page.locator('.word-finish')).toHaveCount(0);
  // Supplement disabled-state assertions with queued handler attempts while the response is held.
  for (const key of ['ArrowLeft', 'r', 'Enter', ' ']) await page.locator('.word-token').dispatchEvent('keydown', { key });
  for (const selector of ['.word-rotate', '.word-confirm', '.word-cancel']) await page.locator(selector).dispatchEvent('click');
  await page.locator('.word-workbench').dispatchEvent('keydown', { key: 'Escape' });
  await expectPose(page, pose, true);
}

for (const status of [200, 202] as const) {
  test(`站点模拟：延迟 ${status} 回执保留拖动草稿，等待中不重复提交也不抢先生效`, async ({ page }, testInfo) => {
    const store = emptyStore();
    const initial = createRun(store, 'reply', `mock-wordplay-${status}`);
    let current = initial;
    let submitted!: TurnInput;
    const submitGate = barrier();
    const pollGate = barrier();
    const mock = await installSiteMock(page, initial, () => current, async (route, input) => {
      submitted = input;
      await submitGate.promise;
      if (status === 200) {
        current = submitTurn(store, initial.runId, initial.branchId, input);
        return route.fulfill({ json: current });
      }
      // A pending transport revision is NOT acknowledgement of the proposed pose.
      current = { ...initial, revision: initial.revision + 1, status: 'pending', choices: [], activeRequest: {
        requestId: input.requestId, actionId: input.actionId, label: '模拟服务正在确认文字位置', startedAt: Date.now(), allowFallback: false,
      } };
      return route.fulfill({ status: 202, json: { requestId: input.requestId, status: 'pending', pollUrl: '' } });
    }, async route => {
      await pollGate.promise;
      current = submitTurn(store, initial.runId, initial.branchId, submitted);
      await route.fulfill({ json: current });
    });
    try {
      await page.goto('http://127.0.0.1:5174/#/episode/reply');
      await expect(page).toHaveURL(/#\/play\/[^/]+\/[^/]+$/);
      await expect(page.locator('.word-token')).toBeEnabled();
      const pose = await mouseDraft(page, 28, 25);
      expect(mock.inputs).toHaveLength(0);
      await page.mouse.up();
      await expect.poll(() => mock.inputs.length).toBe(1);
      await expectLockedDraft(page, pose, '10 人签到');
      const blocked = await dragPoints(page, 70, 50);
      await page.mouse.move(blocked.start.x, blocked.start.y);
      await page.mouse.down();
      await page.mouse.move(blocked.end.x, blocked.end.y, { steps: 4 });
      await page.mouse.up();
      await expectPose(page, pose, true);
      expect(mock.inputs[0]).toEqual({ requestId: expect.any(String), stage: 1, expectedRevision: 0, actionId: 'move_one', params: { x: String(pose.x), y: String(pose.y), rotation: '0' } });
      expect(current.wordPlay).toEqual(initial.wordPlay);
      expect(mock.inputs).toHaveLength(1);
      submitGate.release();
      if (status === 202) {
        await expect(page.locator('.pending-panel')).toContainText('模拟服务正在确认文字位置');
        await expect.poll(() => mock.pollPaths.length).toBe(1);
        await expectLockedDraft(page, pose, '10 人签到');
        expect(store.runs[initial.runId].branches[initial.branchId].state.revision).toBe(0);
        expect(mock.inputs).toHaveLength(1);
        await scrollBoard(page);
        await page.screenshot({ path: testInfo.outputPath('mock-wordplay-pending.png') });
        pollGate.release();
      }
      await expect(page.locator('.word-token')).toBeEnabled();
      await expectPose(page, pose);
      await expectEffect(page, 'ten', ['ten']);
      expect(current).toMatchObject({ revision: 1, stage: 1, status: 'ready', ending: null });
      expect(Object.keys(store.runs[initial.runId].branches[initial.branchId].requests)).toHaveLength(1);
      expect(mock.inputs).toHaveLength(1);
      expect(mock.unexpected).toEqual([]);
      expect(await rawSave(page)).toBeNull();
    } finally {
      submitGate.release();
      pollGate.release();
    }
  });
}

test('站点模拟：503后锁定草稿，重试沿用同一requestId和纯字符串坐标，不由客户端决定效果', async ({ page }) => {
  const store = emptyStore();
  const initial = createRun(store, 'reply', 'mock-wordplay-retry');
  let current = initial;
  const retryGate = barrier();
  const mock = await installSiteMock(page, initial, () => current, async (route, input, attempt) => {
    if (attempt === 1) return route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE', message: '模拟位置服务暂不可用', retryable: true } });
    await retryGate.promise;
    current = submitTurn(store, initial.runId, initial.branchId, input);
    await route.fulfill({ json: current });
  });
  try {
    await page.goto('http://127.0.0.1:5174/#/episode/reply');
    await expect(page).toHaveURL(/#\/play\/[^/]+\/[^/]+$/);
    const token = page.locator('.word-token');
    await expect(token).toBeEnabled();
    for (const key of ['Shift+ArrowRight', 'Shift+ArrowRight', 'Shift+ArrowUp', 'Shift+ArrowUp', 'Shift+ArrowUp', 'Shift+ArrowUp', 'r']) await token.press(key);
    const pose: Pose = { x: 70, y: 50, rotation: 90 };
    await expectPose(page, pose, true);
    await expect(page.locator('.word-preview')).toContainText('横过来挡拆');
    expect(mock.inputs).toHaveLength(0);
    await page.locator('.word-confirm').click();
    await expect(page.getByRole('alert')).toContainText('模拟位置服务暂不可用');
    await expect(page.locator('.submission-panel')).toContainText('这次操作尚未确认');
    await expectLockedDraft(page, pose, '横过来挡拆');
    expect(mock.inputs).toHaveLength(1);
    expect(store.runs[initial.runId].branches[initial.branchId].state.revision).toBe(0);
    expect(mock.inputs[0]).toEqual({ requestId: expect.any(String), stage: 1, expectedRevision: 0, actionId: 'move_one', params: { x: '70', y: '50', rotation: '90' } });
    await page.getByRole('button', { name: '重试原操作' }).click();
    await expect.poll(() => mock.inputs.length).toBe(2);
    expect(mock.inputs[1]).toEqual(mock.inputs[0]);
    await expectLockedDraft(page, pose, '横过来挡拆');
    expect(current.wordPlay).toEqual(initial.wordPlay);
    retryGate.release();
    await expect(token).toBeEnabled();
    await expectPose(page, pose);
    await expectEffect(page, 'bridge', ['bridge']);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(current).toMatchObject({ revision: 1, stage: 1, status: 'ready', wordPlay: { ...pose, effect: 'bridge', discovered: ['bridge'] } });
    expect(Object.keys(store.runs[initial.runId].branches[initial.branchId].requests)).toHaveLength(1);
    await page.reload();
    await expect(token).toBeEnabled();
    await expectPose(page, pose);
    await expectEffect(page, 'bridge', ['bridge']);
    expect(mock.inputs).toHaveLength(2);
    expect(mock.unexpected).toEqual([]);
    expect(await rawSave(page)).toBeNull();
  } finally {
    retryGate.release();
  }
});
