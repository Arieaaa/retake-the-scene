import { expect, test, type Page } from '@playwright/test';
import type { PlayerView } from '../../shared/contracts';

async function act(page: Page, actionId: string) {
  const result = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/turns'));
  await page.locator(`[data-action="${actionId}"]`).click();
  const response = await result;
  expect(response.status()).toBe(200);
  return await response.json() as PlayerView;
}

async function current(page: Page) {
  return await page.evaluate(async () => {
    const [, , run, branch] = location.hash.split('/');
    const response = await fetch(`/functions/v1/app/api/runs/${run}/branches/${branch}`);
    return await response.json();
  }) as PlayerView;
}

test('真实本地后端：婚礼、刷新、倒带与跨访客拒绝', async ({ page, browser, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.poster-card')).toHaveCount(5);
  await page.locator('[data-episode="wedding"]').click();
  await expect(page.locator('[data-action="preview_tail"]')).toBeEnabled();
  const opening = await current(page);
  await act(page, 'preview_tail');
  const consent = await act(page, 'private_preview');
  expect(consent.presentation.consent).toBe(true);
  const ended = await act(page, 'lend_laptop');
  await expect(page.locator('.scene-title h1')).toHaveText('婚礼现场返工版');
  expect(ended.visibleEvents.some(event => event.source === 'live')).toBe(false);
  await page.reload();
  await expect(page.locator('.scene-title h1')).toHaveText('婚礼现场返工版');
  expect((await current(page)).visibleEvents).toEqual(ended.visibleEvents);
  expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBeNull();
  expect(await page.evaluate(() => document.cookie)).not.toContain('retake_visitor');
  expect((await page.context().cookies()).find(cookie => cookie.name === 'retake_visitor_local')?.httpOnly).toBe(true);

  const stranger = await browser.newContext({ baseURL });
  try {
    const response = await stranger.request.get(`/functions/v1/app/api/runs/${ended.runId}/branches/${ended.branchId}`);
    expect(response.status()).toBe(404);
  } finally { await stranger.close(); }

  await page.getByRole('button', { name: '倒带', exact: true }).click();
  const fork = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/forks'));
  await page.getByRole('button', { name: /第 2 拍前/ }).click();
  expect((await fork).status()).toBe(201);
  await expect(page.locator('[data-action="private_preview"]')).toBeEnabled();
  const rewound = await current(page);
  expect(rewound.runId).toBe(opening.runId);
  expect(rewound.branchId).not.toBe(ended.branchId);
  expect(rewound.presentation.consent).toBe(false);
  await act(page, 'watch_table');
  await expect(page.locator('[data-action="lend_laptop"]')).toHaveCount(0);
  await act(page, 'offer_mic');
  await expect(page.locator('.scene-title h1')).toHaveText('这桌先上鱼');
  await page.goto(`/#/play/${ended.runId}/${ended.branchId}`);
  await expect(page.locator('.scene-title h1')).toHaveText('婚礼现场返工版');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('真实本地后端：文字落位、刷新与主动谢幕', async ({ page }) => {
  await page.goto('/#/episode/reply');
  const token = page.locator('.word-token');
  await expect(token).toBeEnabled();
  await token.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  const submitted = page.waitForResponse(response => response.url().endsWith('/turns'));
  await page.keyboard.press('Enter');
  expect((await submitted).status()).toBe(200);
  const positioned = await current(page);
  expect(positioned.revision).toBe(1);
  expect(positioned.stage).toBe(1);
  await page.reload();
  await expect(token).toBeEnabled();
  expect((await current(page)).wordPlay).toEqual(positioned.wordPlay);
  await token.focus();
  for (let step = 0; step < 10; step++) await page.keyboard.press('ArrowLeft');
  for (let step = 0; step < 6; step++) await page.keyboard.press('Shift+ArrowUp');
  const moved = page.waitForResponse(response => response.url().endsWith('/turns'));
  await page.keyboard.press('Enter');
  expect((await moved).status()).toBe(200);
  expect((await current(page)).wordPlay?.effect).toBe('ten');
  const finish = page.waitForResponse(response => response.url().endsWith('/turns'));
  await page.locator('.word-finish').click();
  expect((await finish).status()).toBe(200);
  await expect(page.locator('.scene-title h1')).toHaveText('这次，1 不止一种意思');
  expect((await current(page)).ending?.id).toBe('reply.wordplay');
});

test('真实本地后端：未接入 NPC 时不宣称自由回应', async ({ page }) => {
  await page.goto('/#/episode/office');
  await expect(page.locator('[data-action="read_roster"]')).toBeEnabled();
  await expect(page.getByRole('form', { name: '自由接戏' })).toHaveCount(0);
  await expect(page.locator('.capability-note')).toContainText('尚未开放自由接戏');
  const view = await act(page, 'read_roster');
  expect(view.freePlay).toBeUndefined();
  expect(view.revision).toBe(1);
});
