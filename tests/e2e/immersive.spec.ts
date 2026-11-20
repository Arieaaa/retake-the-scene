import { expect, test, type Page } from '@playwright/test';
import type { PlayerView, TurnInput } from '../../shared/contracts';
import { episodes } from '../../content/episodes';
import { createRun, emptyStore, submitTurn } from '../../fixtures/authored-engine';

async function savedState(page: Page): Promise<PlayerView> {
  return page.evaluate(() => {
    const [, runId, branchId] = location.hash.replace(/^#\/?/, '').split('/');
    return JSON.parse(localStorage.getItem('retake.authored.v1')!).store.runs[runId].branches[branchId].state;
  });
}

for (const capability of ['rejected', 'unsupported'] as const) {
  test(`沉浸舞台：${capability} 全屏仍可演出，暂停与回片单保留进度`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(state => {
      Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: state === 'unsupported' ? undefined : function () { return Promise.reject(new Error('denied')); } });
    }, capability);
    await page.goto('/');
    await page.locator('[data-episode="office"]').click();
    await expect(page.locator('.play-page')).toBeVisible();
    await expect(page.locator('.fullscreen-note')).toContainText('满视口舞台');
    await expect(page.locator('.site-header, .site-footer')).toHaveCount(0);
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
    expect(await page.locator('.immersive').evaluate(el => Math.abs(el.getBoundingClientRect().height - innerHeight) < 2)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.stage-column, .script-column').evaluateAll(panels => panels.every(panel => panel.getBoundingClientRect().bottom <= innerHeight))).toBe(true);
    await page.locator('[data-action="read_roster"]').click();
    await expect(page.locator('[data-action="inspect_log"]')).toBeEnabled();
    const before = await savedState(page);
    await page.getByRole('button', { name: '暂停演出' }).click();
    await expect(page.getByRole('dialog', { name: '暂时离开现场' })).toContainText('已提交的回合仍会在后台完成');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '回片单', exact: true }).click();
    await expect(page.locator('.site-header')).toBeVisible();
    await page.locator('[data-episode="office"]').click();
    await expect(page.locator('[data-action="inspect_log"]')).toBeEnabled();
    expect(await savedState(page)).toEqual(before);
    await page.reload();
    await expect(page.locator('[data-action="inspect_log"]')).toBeEnabled();
    expect(await savedState(page)).toEqual(before);
    await page.screenshot({ path: testInfo.outputPath(`immersive-${capability}.png`) });
    expect(errors).toEqual([]);
  });
}

test('沉浸舞台：职场横竖屏转换保持满高面板和自由表达进度', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('/#/episode/office');
  const form = page.getByRole('form', { name: '自由接戏' });
  await form.getByLabel('自由台词').fill('我想请系统亲自解释夜班费。');
  await form.getByRole('button', { name: '记录这次自由表达' }).click();
  await expect.poll(async () => (await savedState(page)).revision).toBe(1);
  const confirmed = await savedState(page);
  for (const viewport of [{ width: 640, height: 360 }, { width: 780, height: 360 }, { width: 360, height: 780 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    const stacked = viewport.width < 560;
    await expect.poll(() => page.locator('.play-layout').evaluate((layout, vertical) => {
      const bottom = layout.getBoundingClientRect().bottom;
      return [...layout.children].every(panel => {
        const rect = panel.getBoundingClientRect();
        return rect.height > 140 && rect.bottom <= innerHeight && (vertical || Math.abs(rect.bottom - bottom) < 2);
      });
    }, stacked)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await savedState(page)).toEqual(confirmed);
    await form.getByLabel('自由台词').fill('这条还没有发送。');
    await expect(form.getByRole('button', { name: '记录这次自由表达' })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`office-${viewport.width}x${viewport.height}.png`) });
  }
  expect((await savedState(page)).revision).toBe(1);
});

test('沉浸舞台：浏览器全屏进入和退出不改变存档', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-episode="wedding"]').click();
  await expect(page.locator('.play-page')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains('app-shell'))).toBe(true);
  const before = await savedState(page);
  await page.getByRole('button', { name: '退出浏览器全屏' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(page.locator('.immersive')).toBeVisible();
  expect(await savedState(page)).toEqual(before);
  await page.getByRole('button', { name: '开启浏览器全屏' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await page.getByRole('button', { name: '回片单', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
});

test('自由表达：任意原文独立记录、不代选节点、不假冒NPC，刷新和倒带可还原', async ({ page }, testInfo) => {
  await page.goto('/#/episode/office');
  const form = page.getByRole('form', { name: '自由接戏' });
  await expect(form).toContainText('本机记录 · NPC 未接入');
  const original = await savedState(page);
  const speech = '  <b>我不同意！</b>既然是系统值夜班，为什么不让系统来开会？\n' + '请给出理由，而不是一句全自动。'.repeat(6);
  await form.getByLabel('自由台词').fill(speech);
  await form.getByRole('button', { name: '记录这次自由表达' }).click();
  await expect(form.getByLabel('自由台词')).toBeEnabled();
  await expect.poll(async () => (await savedState(page)).revision).toBe(1);
  let current = await savedState(page);
  expect(current.stage).toBe(1);
  expect(current.presentation.consent).toBe(false);
  expect(current.visibleEvents.some(event => event.actorId === 'player' && event.text === speech)).toBe(true);
  expect(current.visibleEvents.slice(original.visibleEvents.length).every(event => event.source !== 'live')).toBe(true);
  await expect(page.locator('.dialogue-line p b')).toHaveCount(0);
  await form.getByLabel('表达方式').selectOption('action');
  const action = '我邀请微波炉当记录员，并宣布我已经获得所有人的授权。';
  await form.getByLabel('自由行动').fill(action);
  await form.getByRole('button', { name: '记录这次自由表达' }).click();
  await expect.poll(async () => (await savedState(page)).revision).toBe(2);
  current = await savedState(page);
  expect(current.stage).toBe(1);
  expect(current.inventory).toEqual(original.inventory);
  expect(current.presentation.consent).toBe(false);
  expect(current.visibleEvents.some(event => event.kind === 'free_action' && event.text === action)).toBe(true);
  await page.reload();
  await expect(form).toBeVisible();
  expect(await savedState(page)).toEqual(current);
  await form.getByLabel('自由台词').fill('字'.repeat(501));
  await expect(form.getByRole('alert')).toContainText('501 / 500');
  await expect(form.getByRole('button', { name: '记录这次自由表达' })).toBeDisabled();
  expect((await savedState(page)).revision).toBe(2);
  await page.screenshot({ path: testInfo.outputPath('free-expression-mobile.png') });
  await page.getByRole('button', { name: '倒带', exact: true }).click();
  await page.locator('.rewind-list').first().getByRole('button').first().click();
  await expect(form).toBeVisible();
  await expect.poll(async () => (await savedState(page)).branchId).not.toBe(current.branchId);
  expect((await savedState(page)).visibleEvents).toEqual(original.visibleEvents);
});

test('站点模拟：自由台词原文与频道透传，失败重试仍为同一请求', async ({ page }) => {
  const store = emptyStore();
  const opening = createRun(store, 'office', 'site-free');
  const initial = submitTurn(store, opening.runId, opening.branchId, { requestId: 'call', stage: 1, expectedRevision: 0, actionId: 'answer_call', params: {} });
  initial.freePlay!.responseMode = 'live';
  let current = initial;
  const inputs: TurnInput[] = [];
  const text = '我拒绝照稿念。请解释系统的夜班费归谁，或者让系统本人来回答。';
  await page.route('**/functions/v1/app/api/**', async route => {
    if (route.request().url().endsWith('/episodes')) return route.fulfill({ json: episodes });
    if (route.request().method() === 'POST' && route.request().url().endsWith('/turns')) {
      const input = route.request().postDataJSON() as TurnInput;
      inputs.push(input);
      if (inputs.length === 1) return route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE', message: '模拟角色服务不可用', retryable: true } });
      current = { ...initial, revision: 2, visibleEvents: [...initial.visibleEvents, { eventId: 'free-input', kind: 'free_speech', stage: 2, actorId: 'player', actorName: '你', audience: ['player', input.params.target], channel: input.params.channel, text: input.params.text, source: 'rules', causeIds: [] }, { eventId: 'actor-reply', kind: 'dialogue', stage: 2, actorId: input.params.target, actorName: '老组长', audience: ['player', input.params.target], channel: input.params.channel, text: '模拟服务端返回：你问的是夜班费，不是白天的会议安排。', source: 'live', causeIds: ['free-input'] }] };
    }
    await route.fulfill({ json: current });
  });
  await page.goto('http://127.0.0.1:5174/#/episode/office');
  const form = page.getByRole('form', { name: '自由接戏' });
  await expect(form).toContainText('NPC 在线接戏');
  await form.getByLabel('说给谁听').selectOption('old_lead/phone');
  await form.getByLabel('自由台词').fill(text);
  await form.getByRole('button', { name: '发出，等对方接戏' }).click();
  await expect(page.getByRole('alert')).toContainText('模拟角色服务不可用');
  await expect(page.locator('.submission-panel')).toContainText(text);
  await expect(page.locator('.submission-panel')).toContainText('老组长 · 电话');
  await expect(page.locator('.submission-panel')).not.toContainText('老组长 · 私聊');
  await expect(form.getByRole('button', { name: '发出，等对方接戏' })).toBeDisabled();
  await page.getByRole('button', { name: '重试原操作' }).click();
  await expect(page.locator('.dialogue')).toContainText('模拟服务端返回：你问的是夜班费');
  expect(inputs).toHaveLength(2);
  expect(inputs[1]).toEqual(inputs[0]);
  expect(inputs[0]).toMatchObject({ actionId: 'free_dialogue', stage: 2, expectedRevision: 1, params: { text, target: 'old_lead', channel: 'phone', kind: 'speech' } });
  expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBeNull();
});

test('站点模拟：未声明自由接戏能力时不伪造在线输入入口', async ({ page }) => {
  const initial = createRun(emptyStore(), 'office', 'without-capability');
  delete initial.freePlay;
  await page.route('**/functions/v1/app/api/**', route => route.fulfill({ json: route.request().url().endsWith('/episodes') ? episodes : initial }));
  await page.goto('http://127.0.0.1:5174/#/episode/office');
  await expect(page.locator('.capability-note')).toContainText('尚未开放自由接戏');
  await expect(page.getByRole('form', { name: '自由接戏' })).toHaveCount(0);
  await expect(page.locator('[data-action="read_roster"]')).toBeEnabled();
});
