import { expect, test, type Page } from '@playwright/test';
import acceptance from '../../五剧十五结局-验收样例.json' with { type: 'json' };
import type { PlayerView } from '../../shared/contracts';

async function readView(page: Page): Promise<PlayerView> {
  const match = new URL(page.url()).hash.match(/^#\/play\/([^/]+)\/([^/]+)$/);
  expect(Boolean(match), '页面应定位到实际局与分支').toBe(true);
  const response = await page.context().request.get(`${new URL(page.url()).origin}/functions/v1/app/api/runs/${encodeURIComponent(match![1])}/branches/${encodeURIComponent(match![2])}`);
  expect(response.status(), '当前匿名会话应能读取自己的玩家视图').toBe(200);
  const view = await response.json() as PlayerView;
  expect(view.runId === match![1] && view.branchId === match![2], '接口视图必须属于当前路由').toBe(true);
  return view;
}

test.beforeEach(() => {
  if (process.env.RETAKE_LIVE_ALLOW_WRITES !== '1') throw new Error('五集抽检会创建真实测试局并可能调用付费角色；明确允许后设置 RETAKE_LIVE_ALLOW_WRITES=1。只读检查使用 --project=preflight。');
});

for (const episodeId of ['wedding', 'office', 'romance', 'hiss', 'reply']) {
  const scenario = acceptance.cases.find(item => item.episodeId === episodeId);
  if (!scenario) throw new Error(`Missing public smoke path: ${episodeId}`);
  test(`真实站点手机抽检：${episodeId}开场、结局、刷新与新访客分享`, async ({ page, context, browser, baseURL }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.name));
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(baseURL!).origin });
    await page.goto(baseURL!);
    await expect(page.locator('.mode-pill')).toHaveText('在线演出');
    await expect(page.getByLabel('开启声音')).toBeVisible();
    async function activate(selector: string) {
      const button = page.locator(selector);
      await expect(button).toBeEnabled({ timeout: 30000 });
      for (let tabs = 0; tabs < 40 && !await button.evaluate(element => element === document.activeElement); tabs++) await page.keyboard.press('Tab');
      await expect(button).toBeFocused();
      await page.keyboard.press('Enter');
    }
    await activate(`[data-episode="${episodeId}"]`);
    await expect(page.locator(`[data-action="${scenario.turns[0].actionId}"]`)).toBeEnabled({ timeout: 30000 });
    const opening = await readView(page);
    expect(opening.episodeId).toBe(episodeId);
    expect(opening.stage).toBe(1);
    expect(opening.ending).toBeNull();
    for (const turn of scenario.turns) {
      await activate(`[data-action="${turn.actionId}"]`);
      if (episodeId === 'reply' && /^(quote_|reply_)/.test(turn.actionId)) {
        await expect(page.getByRole('dialog', { name: '确认引用这条消息' })).toBeVisible();
        await activate('button[data-confirm-quote]');
      }
      if (turn.actionId === 'ask_friend') {
        const preview = page.getByRole('dialog', { name: '确认转发给阿圆' });
        await expect(preview).toBeVisible();
        const current = await readView(page);
        const original = current.visibleEvents.find(event => event.eventId === current.presentation.friendForwardPreviewEventId
          && event.actorId === 'soda' && event.audience.includes('player') && ['soda', 'coach'].includes(event.channel));
        expect(original, '转发预览必须引用当前真实玩家视图中可见的汽水历史消息').toBeDefined();
        await expect(preview.locator('.forward-preview p')).toHaveText(original!.text);
        await expect(preview.locator('.forward-preview')).toContainText(original!.actorName);
        await expect(preview.locator('.forward-preview')).toContainText(original!.channel === 'soda' ? '汽水窗口' : '退堂鼓窗口');
        await activate('button[data-confirm-forward]');
      }
    }
    await expect(page.locator('.ending-panel')).toBeVisible({ timeout: 30000 });
    const ended = await readView(page);
    expect(ended.scriptVersion).toBe(acceptance.scriptVersion);
    expect(ended.ending?.id).toBe(scenario.expected.endingId);
    expect(ended.visibleEvents.map(event => event.kind)).toEqual(expect.arrayContaining(scenario.expected.requiredEvents));
    expect(new Set(ended.visibleEvents.map(event => event.eventId)).size).toBe(ended.visibleEvents.length);
    expect(ended.visibleEvents.every(event => ['rules', 'authored', 'live'].includes(event.source))).toBe(true);
    await expect(page.locator('.scene-title h1')).toHaveText(scenario.expected.title);
    await expect(page.locator('.scene-title .last-line')).toHaveText(`“${ended.ending!.line}”`);
    const firstChange = ended.visibleEvents.find(event => event.eventId === ended.presentation.firstChangedEventId && event.audience.includes('player'));
    expect(firstChange, '候选版须提供当前分支可核对的首改动引用').toBeDefined();
    await expect(page.locator('.ending-change-text')).toHaveText(firstChange!.text);
    await expect(page.getByLabel('开启声音')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const oldRoute = page.url();
    await page.reload();
    await expect(page.locator('.ending-panel')).toBeVisible({ timeout: 30000 });
    const restored = await readView(page);
    expect(restored.revision).toBe(ended.revision);
    expect(restored.visibleEvents).toEqual(ended.visibleEvents);
    expect(restored.ending?.id).toBe(ended.ending?.id);

    await page.getByRole('button', { name: '分享开场' }).click();
    const shared = new URL(await page.evaluate(() => navigator.clipboard.readText()));
    expect(shared.origin).toBe(new URL(baseURL!).origin);
    expect(shared.hash).toBe(`#/episode/${episodeId}`);
    expect(shared.search).toBe('');
    const visitor = await browser.newContext({ viewport: { width: 360, height: 780 }, reducedMotion: 'reduce' });
    try {
      const fresh = await visitor.newPage();
      await fresh.goto(shared.href);
      await expect(fresh.locator(`[data-action="${scenario.turns[0].actionId}"]`)).toBeEnabled({ timeout: 30000 });
      const freshView = await readView(fresh);
      expect(freshView.runId === ended.runId, '新访客不得复用原存档').toBe(false);
      expect(freshView.episodeId).toBe(episodeId);
      expect(freshView.stage).toBe(1);
      expect(freshView.ending).toBeNull();
      await expect(fresh.getByLabel('开启声音')).toBeVisible();
      expect(await fresh.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBeNull();
    } finally { await visitor.close(); }

    if (episodeId === 'wedding') {
      const checkpoint = ended.checkpoints.findIndex(item => item.stage === 2);
      expect(checkpoint).toBeGreaterThanOrEqual(0);
      await page.getByRole('button', { name: '倒回去，换个演法' }).click();
      await page.locator('.rewind-list').first().getByRole('button').nth(checkpoint).click();
      await expect(page.locator('[data-action="private_preview"]')).toBeEnabled({ timeout: 30000 });
      const forked = await readView(page);
      expect(forked.branchId === ended.branchId).toBe(false);
      expect(forked.revision).toBe(0);
      expect(forked.visibleEvents.some(event => event.kind === 'consent_granted')).toBe(false);
      await page.goto(oldRoute);
      await expect(page.locator('.ending-panel')).toBeVisible({ timeout: 30000 });
      expect((await readView(page)).visibleEvents).toEqual(ended.visibleEvents);
    }
    expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBeNull();
    expect(errors).toEqual([]);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await testInfo.attach('player-observations', { contentType: 'application/json', body: JSON.stringify({
      scope: 'A玩家侧黑盒抽检，不是云角色执行或数据库原子写证明',
      episodeId, scriptVersion: ended.scriptVersion, endingId: ended.ending?.id,
      visibleEventCount: ended.visibleEvents.length,
      sources: Object.fromEntries(['rules', 'authored', 'live'].map(source => [source, ended.visibleEvents.filter(event => event.source === source).length])),
      restored: true, freshVisitorAtOpening: true, cloudExecutionVerified: false,
    }, null, 2) });
  });
}
