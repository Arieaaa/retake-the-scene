import { expect, test, type Route } from '@playwright/test';
import { episodes } from '../../content/episodes';
import { createRun, emptyStore, readBranch, submitTurn } from '../../fixtures/authored-engine';
import { previewViews } from '../../fixtures/public/views';
import acceptance from '../../五剧十五结局-验收样例.json' with { type: 'json' };
import type { EpisodeId, PlayerView, TurnInput } from '../../shared/contracts';

const origin = 'http://127.0.0.1:5174';
const api = '**/functions/v1/app/api/**';

test('站点模拟：503不切换预演，原操作重试可恢复片单', async ({ page }) => {
  let unavailable = true;
  await page.route(api, route => route.fulfill({ status: unavailable ? 503 : 200, json: unavailable ? { code: 'SERVICE_UNAVAILABLE', message: '服务暂不可用', retryable: true } : episodes }));
  await page.goto(origin);
  await expect(page.getByRole('alert')).toContainText('服务暂不可用');
  await expect(page.locator('.poster-card')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBeNull();
  unavailable = false;
  await page.getByRole('button', { name: '重试原操作' }).click();
  await expect(page.locator('.poster-card')).toHaveCount(5);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('站点模拟：片单响应不能清掉存档404，预览地址不可访问样例', async ({ page }) => {
  await page.route(api, async route => {
    if (route.request().url().endsWith('/episodes')) {
      await new Promise(resolve => setTimeout(resolve, 150));
      await route.fulfill({ json: episodes });
    } else await route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: '存档不可访问', retryable: false } });
  });
  await page.goto(`${origin}/#/play/not-owned/branch`);
  await expect(page.getByRole('alert')).toContainText('存档不可访问');
  await expect(page.locator('.loading-block')).toHaveCount(0);
  await page.goto(`${origin}/#/preview/consent`);
  await expect(page.getByRole('alert')).toContainText('这个现场不存在');
  await expect(page.locator('.play-page')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBeNull();
});

for (const reference of ['visible', 'missing', 'unknown'] as const) {
  test(`站点模拟：谢幕顺序与${reference}首改动引用保持只读`, async ({ page }, testInfo) => {
    const ended = structuredClone(previewViews.ended);
    const firstChange = ended.visibleEvents[2];
    firstChange.text = '<b>本分支最先改变的是电脑小窗</b>';
    if (reference === 'missing') delete ended.presentation.firstChangedEventId;
    else ended.presentation.firstChangedEventId = reference === 'visible' ? firstChange.eventId : 'not-in-player-view';
    let current = ended;
    const writes: string[] = [];
    await page.route(api, async route => {
      if (route.request().method() !== 'GET') writes.push(route.request().method());
      await route.fulfill({ json: route.request().url().endsWith('/episodes') ? episodes : current });
    });
    await page.goto(`${origin}/#/play/${ended.runId}/${ended.branchId}`);
    const closingLine = page.locator('.scene-title .last-line');
    const change = page.getByRole('region', { name: '第一处被你改变的事件' });
    await expect(closingLine).toHaveText(`“${ended.ending!.line}”`);
    await expect(closingLine).toBeFocused();
    if (reference === 'visible') {
      await expect(change.locator('.ending-change-text')).toHaveText(firstChange.text);
      await expect(change.locator('.ending-change-text b')).toHaveCount(0);
      await expect(change).toContainText(firstChange.actorName);
      await expect(change).toContainText(firstChange.channel);
      await expect(change).toContainText('现场规则');
    } else {
      await expect(change).toContainText('当前视图没有提供可核对的首个改动事件。');
      await expect(change.locator('.ending-change-text')).toHaveCount(0);
      await expect(change).not.toContainText(firstChange.text);
    }
    expect(await page.evaluate(() => {
      const line = document.querySelector('.scene-title .last-line')!;
      const title = document.querySelector('.scene-title h1')!;
      const change = document.querySelector('.ending-change')!;
      const actions = document.querySelector('.ending-actions')!;
      return [line.compareDocumentPosition(title), title.compareDocumentPosition(change), change.compareDocumentPosition(actions)].every(position => Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING));
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('ending-order-and-change.png'), fullPage: true });
    const saved = await page.evaluate(() => localStorage.getItem('retake.progress.site'));
    await page.reload();
    await expect(closingLine).toHaveText(`“${ended.ending!.line}”`);
    expect(await page.evaluate(() => localStorage.getItem('retake.progress.site'))).toBe(saved);
    current = structuredClone(previewViews.ready);
    await page.goto(`${origin}/#/play/${ended.runId}/another-branch`);
    await expect(page.locator('[data-action="preview_tail"]')).toBeEnabled();
    await expect(change).toHaveCount(0);
    await expect(closingLine).toHaveCount(0);
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBeNull();
  });
}

for (const status of ['ready', 'pending', 'ended'] as const) {
  test(`站点模拟：${status}完整回看与物证只读`, async ({ page }, testInfo) => {
    const view: PlayerView = structuredClone(status === 'ended' ? previewViews.ended : previewViews.consent);
    view.status = status;
    view.visibleEvents.push(...Array.from({ length: 9 }, (_, index) => ({ ...view.visibleEvents[0], eventId: `history-${index}`, stage: [3, 2, 3][index % 3], text: `已发生的可见记录 ${index + 1}` })));
    if (status === 'pending') {
      view.choices = [];
      view.activeRequest = { requestId: 'pending-with-clues', actionId: 'lend_laptop', label: '把电脑交给她编辑', startedAt: Date.now(), allowFallback: true };
    }
    const writes: string[] = [];
    await page.route(api, async route => {
      if (route.request().method() !== 'GET') writes.push(route.request().method());
      if (route.request().url().endsWith('/episodes')) await route.fulfill({ json: episodes });
      else if (route.request().url().includes('/turns/')) await route.fulfill({ status: 202, json: { requestId: view.activeRequest!.requestId, status: 'pending', pollUrl: '' } });
      else await route.fulfill({ json: view });
    });
    await page.goto(`${origin}/#/play/${view.runId}/${view.branchId}`);
    const clues = page.getByRole('button', { name: `已获物证 ${view.inventory.length}` });
    await expect(clues).toBeEnabled();
    await clues.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('dialog .clue-card h3')).toHaveText(view.inventory.map(clue => clue.title));
    await expect(page.locator('dialog .clue-card p')).toHaveText(view.inventory.map(clue => clue.text));
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog')).toHaveCount(0);
    await expect(page.locator('.dialogue-line p')).toHaveText(view.visibleEvents.map(event => event.text));
    await clues.focus();
    await page.keyboard.press('Tab');
    const log = page.getByRole('log');
    await expect(log).toBeFocused();
    await page.keyboard.press('Home');
    await expect.poll(() => log.evaluate(element => element.scrollTop)).toBe(0);
    await expect(page.locator('.dialogue-line p').first()).toBeInViewport();
    await page.keyboard.press('End');
    await expect(page.locator('.dialogue-line p').last()).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('replay-and-clues.png'), fullPage: true });
    const saved = await page.evaluate(() => localStorage.getItem('retake.progress.site'));
    await page.reload();
    await expect(page.locator('.dialogue-line p')).toHaveText(view.visibleEvents.map(event => event.text));
    expect(await page.evaluate(() => localStorage.getItem('retake.progress.site'))).toBe(saved);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(writes).toEqual([]);
  });
}

test('站点模拟：引用草稿只认当前可见楼层，取消零写入、断网沿原楼层重试', async ({ page }) => {
  const ready: PlayerView = { ...structuredClone(previewViews.ready), episodeId: 'reply', presentation: { quote_gameParentMessageId: 'projected-ball-message' }, choices: [{ actionId: 'quote_game', label: '引用 · 缺人球局', control: 'message', targets: [{ id: 'baller', label: '球友的球局楼', channel: 'group' }] }], visibleEvents: [] };
  const parent = { ...previewViews.ready.visibleEvents[0], eventId: 'projected-ball-message', actorId: 'baller', actorName: '球友', channel: 'group', text: '<b>周六打球差一个</b>' };
  let available = false;
  let current = ready;
  const inputs: TurnInput[] = [];
  await page.route(api, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/episodes')) return route.fulfill({ json: episodes });
    if (path.endsWith('/turns')) {
      inputs.push(route.request().postDataJSON());
      if (inputs.length === 1) return route.abort('internetdisconnected');
      current = { ...ready, revision: 1, stage: 2, choices: [{ actionId: 'inspect_frame', label: '看缺人通知的帧', control: 'button' }] };
    }
    return route.fulfill({ json: { ...current, visibleEvents: available ? [parent] : [] } });
  });
  await page.goto(`${origin}/#/play/${ready.runId}/${ready.branchId}`);
  await page.locator('[data-action="quote_game"]').click();
  const draft = page.getByRole('dialog', { name: '确认引用这条消息' });
  await expect(draft.getByRole('alert')).toContainText('该引用楼层暂不可见');
  await expect(draft.getByRole('button', { name: '确认引用并发送 1' })).toBeDisabled();
  expect(inputs).toEqual([]);
  available = true;
  await page.reload();
  await page.locator('[data-action="quote_game"]').click();
  await expect(draft.locator('.quote-parent p')).toHaveText(parent.text);
  await expect(draft.locator('.quote-parent p b')).toHaveCount(0);
  await draft.getByRole('button', { name: '撤回草稿，重新选楼' }).click();
  expect(inputs).toEqual([]);
  await page.locator('[data-action="quote_game"]').click();
  await draft.getByRole('button', { name: '确认引用并发送 1' }).click();
  await expect(page.getByRole('alert')).toContainText('网络');
  await expect(page.locator('.submission-panel')).toContainText('这次操作尚未确认');
  await expect(page.locator('.submission-text')).toHaveText('1');
  expect(inputs).toHaveLength(1);
  expect(inputs[0].params).toEqual({ parentMessageId: parent.eventId, target: 'baller', channel: 'group', text: '1' });
  await page.getByRole('button', { name: '重试原操作' }).click();
  await expect(page.locator('[data-action="inspect_frame"]')).toBeEnabled();
  expect(inputs).toHaveLength(2);
  expect(inputs[1]).toEqual(inputs[0]);
  expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBeNull();
});

for (const channel of ['soda', 'coach']) {
  test(`站点模拟：转发${channel}原文预览、取消和断网原请求重试`, async ({ page }, testInfo) => {
    const original = { ...previewViews.ready.visibleEvents[0], eventId: `forward-${channel}`, actorId: 'soda', actorName: channel === 'soda' ? '汽水' : '退堂鼓', channel, text: '<b>今天 21:10 · 只确认转发这一条</b>' };
    const ready: PlayerView = { ...structuredClone(previewViews.ready), episodeId: 'romance', presentation: { friendForwardPreviewEventId: original.eventId }, choices: [{ actionId: 'ask_friend', label: '把已预览的一段转给阿圆', control: 'message', targets: [{ id: 'friend', label: '阿圆 · 私聊', channel: 'friend' }] }], visibleEvents: [original, { ...original, eventId: 'not-forwarded', text: '另一窗不可一起转发', channel: channel === 'soda' ? 'coach' : 'soda' }], inventory: [{ id: 'draft', title: '未发送草稿', text: '未发送草稿不可一起转发' }] };
    let current = ready;
    const inputs: TurnInput[] = [];
    await page.route(api, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/episodes')) return route.fulfill({ json: episodes });
      if (path.endsWith('/turns')) {
        inputs.push(route.request().postDataJSON());
        if (inputs.length === 1) return route.abort('internetdisconnected');
        current = { ...ready, revision: 1, stage: 2, choices: [{ actionId: 'compare_thursday', label: '对照星期四', control: 'button' }] };
      }
      return route.fulfill({ json: current });
    });
    await page.goto(`${origin}/#/play/${ready.runId}/${ready.branchId}`);
    await page.locator('[data-action="ask_friend"]').click();
    const draft = page.getByRole('dialog', { name: '确认转发给阿圆' });
    await expect(draft).toBeVisible();
    await expect(draft.locator('.forward-preview p')).toHaveText(original.text);
    await expect(draft.locator('.forward-preview p b')).toHaveCount(0);
    await expect(draft.locator('.forward-preview')).toContainText(original.actorName);
    await expect(draft.locator('.forward-preview')).toContainText(channel === 'soda' ? '汽水窗口' : '退堂鼓窗口');
    await expect(draft).not.toContainText('另一窗不可一起转发');
    await expect(draft).not.toContainText('未发送草稿不可一起转发');
    await expect(draft).toContainText('不包含其他窗口或未发送草稿');
    await expect(draft.locator('[data-confirm-forward]')).toBeEnabled();
    expect(inputs).toEqual([]);
    await draft.getByLabel('给阿圆的附言（可选）').fill('放弃的附言');
    await draft.getByRole('button', { name: '取消转发' }).click();
    expect(inputs).toEqual([]);
    await page.locator('.choice-wrap').filter({ has: page.locator('[data-action="ask_friend"]') }).getByRole('button', { name: '换一句自己的话' }).click();
    await expect(draft.getByLabel('给阿圆的附言（可选）')).toHaveValue('');
    await expect(draft.getByLabel('给阿圆的附言（可选）')).toHaveAttribute('maxlength', '80');
    await page.keyboard.press('Escape');
    expect(inputs).toEqual([]);
    await page.locator('[data-action="ask_friend"]').click();
    await draft.getByLabel('给阿圆的附言（可选）').fill('  <i>只问这一句</i>  ');
    await page.screenshot({ path: testInfo.outputPath('forward-preview.png') });
    await draft.locator('[data-confirm-forward]').click();
    await expect(page.getByRole('alert')).toContainText('网络');
    await expect(page.locator('.submission-text')).toHaveText('<i>只问这一句</i>');
    expect(inputs).toHaveLength(1);
    expect(inputs[0].params).toEqual({ forwardEventId: original.eventId, target: 'friend', channel: 'friend', text: '<i>只问这一句</i>' });
    await page.getByRole('button', { name: '重试原操作' }).click();
    await expect(page.locator('[data-action="compare_thursday"]')).toBeEnabled();
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toEqual(inputs[0]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBeNull();
  });
}

for (const invalid of ['missing', 'unknown', 'actor', 'channel', 'audience', 'recipient']) {
  test(`站点模拟：转发拒绝${invalid}预览引用`, async ({ page }) => {
    const original = { ...previewViews.ready.visibleEvents[0], eventId: 'forward-reference', actorId: 'soda', actorName: '汽水', channel: 'soda', text: '不合要求的转发原文' };
    const ready: PlayerView = { ...structuredClone(previewViews.ready), episodeId: 'romance', presentation: { friendForwardPreviewEventId: original.eventId }, choices: [{ actionId: 'ask_friend', label: '把已预览的一段转给阿圆', control: 'message', targets: [{ id: 'friend', label: '阿圆 · 私聊', channel: 'friend' }] }], visibleEvents: [original] };
    if (invalid === 'missing') delete ready.presentation.friendForwardPreviewEventId;
    if (invalid === 'unknown') ready.presentation.friendForwardPreviewEventId = 'not-in-this-view';
    if (invalid === 'actor') original.actorId = 'player';
    if (invalid === 'channel') original.channel = 'draft';
    if (invalid === 'audience') original.audience = ['soda'];
    if (invalid === 'recipient') ready.choices[0].targets![0] = { id: 'soda', label: '汽水', channel: 'soda' };
    const writes: string[] = [];
    await page.route(api, route => {
      if (route.request().method() !== 'GET') writes.push(route.request().url());
      return route.fulfill({ json: route.request().url().endsWith('/episodes') ? episodes : ready });
    });
    await page.goto(`${origin}/#/play/${ready.runId}/${ready.branchId}`);
    await page.locator('[data-action="ask_friend"]').click();
    const draft = page.getByRole('dialog', { name: '确认转发给阿圆' });
    await expect(draft.getByRole('alert')).toContainText('暂不能确认转发');
    await expect(draft.locator('[data-confirm-forward]')).toBeDisabled();
    await expect(draft.locator('.forward-preview')).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect(writes).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBeNull();
  });
}

test('站点模拟：首拍旧线入口和对照只读取，不生成回合或分支', async ({ page }) => {
  const ready = structuredClone(previewViews.ready);
  const old = { ...structuredClone(previewViews.ended), runId: ready.runId, branchId: 'old-ended-line' };
  ready.branches = [...ready.branches, { branchId: old.branchId, parentBranchId: null, label: '旧线', endingTitle: old.ending!.title }];
  ready.checkpoints = [];
  const writes: string[] = [];
  await page.route(api, async route => {
    if (route.request().method() !== 'GET') writes.push(route.request().url());
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith('/episodes') ? episodes : path.endsWith(old.branchId) ? old : ready });
  });
  await page.goto(`${origin}/#/play/${ready.runId}/${ready.branchId}`);
  await page.getByRole('button', { name: '倒带', exact: true }).click();
  await page.getByRole('button', { name: `对照：${old.ending!.title}` }).click();
  await expect(page.locator('.branch-compare')).toBeVisible();
  await page.locator('.rewind-list').nth(1).getByRole('button', { name: new RegExp(old.ending!.title) }).click();
  await expect(page.locator('.scene-title h1')).toHaveText(old.ending!.title);
  await expect(page.locator('.dialogue-line p')).toHaveText(old.visibleEvents.map(event => event.text));
  expect(writes).toEqual([]);
});

for (const status of [404, 409, 503]) {
  for (const entry of ['episode/wedding', 'play/old-run/old-branch']) {
    test(`站点模拟：${entry}恢复${status}后显式另开，不删除旧存档`, async ({ page }, testInfo) => {
      const saved = { wedding: { runId: 'old-run', branchId: 'old-branch' }, office: { runId: 'office-run', branchId: 'office-branch' } };
      const ready = { ...structuredClone(previewViews.ready), runId: 'new-run', branchId: 'new-branch' };
      const creates: { episodeId: string; createKey: string }[] = [];
      const writes: string[] = [];
      let reads = 0;
      await page.addInitScript(saved => localStorage.setItem('retake.progress.site', JSON.stringify(saved)), saved);
      await page.route(api, async route => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (request.method() !== 'GET') writes.push(path);
        if (path.endsWith('/episodes')) return route.fulfill({ json: episodes });
        if (path.endsWith('/api/runs')) {
          creates.push(request.postDataJSON());
          return route.fulfill({ json: ready });
        }
        if (path.includes('/old-run/')) {
          reads++;
          return route.fulfill({ status, json: { code: 'RESTORE_FAILED', message: '旧存档暂不可恢复', retryable: status === 503 } });
        }
        return route.fulfill({ json: ready });
      });
      await page.goto(`${origin}/#/${entry}`);
      await expect(page.getByRole('alert')).toContainText('旧存档暂不可恢复');
      await expect(page.getByRole('alert')).toContainText('不删除旧存档');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('recovery.png'), fullPage: true });
      expect(creates).toHaveLength(0);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('retake.progress.site')!))).toEqual(saved);
      await page.getByRole('button', { name: '另开一局', exact: true }).click();
      await expect(page.locator('[data-action="preview_tail"]')).toBeEnabled();
      await expect(page).toHaveURL(`${origin}/#/play/new-run/new-branch`);
      expect(creates).toHaveLength(1);
      expect(creates[0]).toEqual({ episodeId: 'wedding', createKey: expect.any(String) });
      expect(reads).toBe(1);
      expect(writes).toEqual(['/functions/v1/app/api/runs']);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('retake.progress.site')!))).toEqual({ ...saved, wedding: { runId: 'new-run', branchId: 'new-branch' } });
      expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBeNull();
    });
  }
}

test('站点模拟：另开响应丢失后沿用createKey，成功前保留旧位置', async ({ page }) => {
  const saved = { wedding: { runId: 'old-run', branchId: 'old-branch' } };
  const ready = { ...structuredClone(previewViews.ready), runId: 'new-run', branchId: 'new-branch' };
  const creates: { episodeId: string; createKey: string }[] = [];
  await page.addInitScript(saved => localStorage.setItem('retake.progress.site', JSON.stringify(saved)), saved);
  await page.route(api, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/episodes')) return route.fulfill({ json: episodes });
    if (path.endsWith('/api/runs')) {
      creates.push(route.request().postDataJSON());
      if (creates.length === 1) return route.abort('internetdisconnected');
      return route.fulfill({ json: ready });
    }
    if (path.includes('/old-run/')) return route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: '旧存档暂不可恢复', retryable: false } });
    return route.fulfill({ json: ready });
  });
  await page.goto(`${origin}/#/episode/wedding`);
  await page.getByRole('button', { name: '另开一局', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('网络');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('retake.progress.site')!))).toEqual(saved);
  await page.getByRole('button', { name: '重试原操作' }).click();
  await expect(page.locator('[data-action="preview_tail"]')).toBeEnabled();
  expect(creates).toHaveLength(2);
  expect(creates[1]).toEqual(creates[0]);
});

test('站点模拟：另开期间回片单，迟到响应不覆盖路由或旧位置', async ({ page }) => {
  const saved = { wedding: { runId: 'old-run', branchId: 'old-branch' } };
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.addInitScript(saved => localStorage.setItem('retake.progress.site', JSON.stringify(saved)), saved);
  await page.route(api, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/episodes')) return route.fulfill({ json: episodes });
    if (path.endsWith('/api/runs')) {
      await pending;
      return route.fulfill({ json: previewViews.ready });
    }
    return route.fulfill({ status: 404, json: { code: 'NOT_FOUND', message: '旧存档暂不可恢复', retryable: false } });
  });
  await page.goto(`${origin}/#/episode/wedding`);
  const request = page.waitForRequest(request => request.method() === 'POST');
  await page.getByRole('button', { name: '另开一局', exact: true }).click();
  await request;
  await page.getByRole('button', { name: '退出舞台', exact: true }).click();
  await expect(page.locator('.poster-card')).toHaveCount(5);
  const response = page.waitForResponse(response => response.request().method() === 'POST');
  release();
  await response;
  await expect(page.locator('.play-page')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('retake.progress.site')!))).toEqual(saved);
});

test('站点模拟：倒带失败显示错误，重试保留检查点与forkKey', async ({ page }) => {
  const before = structuredClone(previewViews.consent);
  const after = structuredClone(previewViews.rewind);
  const forks: { checkpointId: string; forkKey: string }[] = [];
  await page.route(api, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/episodes')) return route.fulfill({ json: episodes });
    if (path.endsWith('/forks')) {
      forks.push(route.request().postDataJSON());
      if (forks.length === 1) return route.abort('internetdisconnected');
      return route.fulfill({ json: after });
    }
    return route.fulfill({ json: path.endsWith(after.branchId) ? after : before });
  });
  await page.goto(`${origin}/#/episode/wedding`);
  await page.getByRole('button', { name: '倒带', exact: true }).click();
  await page.locator('.rewind-list').first().getByRole('button').nth(1).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('网络');
  await expect(page.locator('[data-action="lend_laptop"]')).toBeDisabled();
  await expect(page.getByRole('button', { name: '倒带', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重试原操作' }).click();
  await expect(page.locator('[data-action="private_preview"]')).toBeEnabled();
  await expect(page).toHaveURL(`${origin}/#/play/${after.runId}/${after.branchId}`);
  expect(forks).toHaveLength(2);
  expect(forks[0]).toEqual({ checkpointId: before.checkpoints[1].id, forkKey: expect.any(String) });
  expect(forks[1]).toEqual(forks[0]);
  await page.goto(`${origin}/#/play/${before.runId}/${before.branchId}`);
  await expect(page.locator('[data-action="lend_laptop"]')).toBeEnabled();
});

for (const operation of ['turn202', 'turn409', 'retry-read', 'fallback', 'fork', 'compare']) {
  for (const outcome of ['success', 'error']) {
    test(`站点模拟：${operation}切页后迟到${outcome}不污染新局`, async ({ page }) => {
      const before = structuredClone(operation === 'fallback' || operation === 'retry-read' ? previewViews.pending : previewViews.consent);
      if (before.activeRequest) before.activeRequest.startedAt = Date.now() - 9000;
      before.branches = structuredClone(previewViews.rewind.branches);
      const other: PlayerView = { ...structuredClone(previewViews.consent), runId: 'other-run', branchId: 'other-branch', scene: { ...previewViews.consent.scene, title: '另一局的现场' }, branches: [{ branchId: 'other-branch', parentBranchId: null, label: '另一局', endingTitle: null }] };
      let release!: () => void;
      let received!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { received = resolve; });
      let deferRead = false;
      async function delayed(route: Route) {
        received();
        await gate;
        return route.fulfill(outcome === 'success' ? { json: previewViews.rewind } : { status: 503, json: { code: 'LATE_ERROR', message: '旧局迟到的错误', retryable: true } });
      }
      await page.route(api, async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/episodes')) return route.fulfill({ json: episodes });
        if (path.includes('/other-run/')) return route.fulfill({ json: other });
        if (path.endsWith('/api/runs')) return route.fulfill({ json: before });
        if (path.endsWith('/turns')) {
          deferRead = true;
          return route.fulfill(operation === 'turn202'
            ? { status: 202, json: { requestId: 'pending-turn', status: 'pending', pollUrl: `${path}/pending-turn` } }
            : { status: 409, json: { code: 'VERSION_CONFLICT', message: '旧局版本变化', retryable: false } });
        }
        if (path.endsWith('/fallback')) {
          if (operation !== 'retry-read') return delayed(route);
          deferRead = true;
          return route.fulfill({ status: 503, json: { code: 'FALLBACK_UNAVAILABLE', message: '请重试查询', retryable: true } });
        }
        if (path.endsWith('/forks') || path.endsWith(previewViews.rewind.branchId)) return delayed(route);
        if (path.includes('/turns/')) return route.fulfill({ status: 202, json: { requestId: before.activeRequest!.requestId, status: 'pending', pollUrl: path } });
        if (deferRead) return delayed(route);
        return route.fulfill({ json: before });
      });
      await page.goto(`${origin}/#/episode/wedding`);
      if (operation.startsWith('turn')) await page.locator('[data-action="lend_laptop"]').click();
      else if (operation === 'fallback' || operation === 'retry-read') {
        await page.getByRole('button', { name: '用编剧预写接下去' }).click();
        if (operation === 'retry-read') {
          await expect(page.getByRole('alert')).toContainText('请重试查询');
          await page.getByRole('button', { name: '重试原操作' }).click();
        }
      } else {
        await page.getByRole('button', { name: '倒带', exact: true }).click();
        if (operation === 'fork') await page.locator('.rewind-list').first().getByRole('button').nth(1).click();
        else await page.getByRole('button', { name: /^对照：/ }).click();
      }
      await started;
      await page.keyboard.press('Escape');
      await page.evaluate(other => { location.hash = `/play/${other.runId}/${other.branchId}`; }, other);
      await expect(page.locator('.scene-title h1')).toHaveText('另一局的现场');
      const saved = await page.evaluate(() => localStorage.getItem('retake.progress.site'));
      const response = page.waitForResponse(response => !response.url().includes('/other-run/') && !response.url().includes('/episodes'));
      release();
      await (await response).finished();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(page.locator('.scene-title h1')).toHaveText('另一局的现场');
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('retake.progress.site'))).toBe(saved);
      await page.getByRole('button', { name: '倒带', exact: true }).click();
      await expect(page.locator('.branch-compare')).toHaveCount(0);
    });
  }
}

for (const responseStatus of [200, 202]) {
  test(`站点模拟：${responseStatus}回执前立即显示原动作与台词`, async ({ page }, testInfo) => {
    const ready = structuredClone(previewViews.consent);
    let current = ready;
    let release!: () => void;
    const reply = new Promise<void>(resolve => { release = resolve; });
    let received!: () => void;
    const receivedTurn = new Promise<void>(resolve => { received = resolve; });
    const inputs: TurnInput[] = [];
    let polls = 0;
    const text = '我想说：<b>请你亲手确认署名</b>。';
    await page.route(api, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/episodes')) return route.fulfill({ json: episodes });
      if (path.endsWith('/turns')) {
        const input = route.request().postDataJSON() as TurnInput;
        inputs.push(input);
        received();
        await reply;
        if (responseStatus === 200) {
          current = structuredClone(previewViews.ended);
          return route.fulfill({ json: current });
        }
        current = { ...ready, status: 'pending', choices: [], activeRequest: { requestId: input.requestId, actionId: input.actionId, label: '把电脑交给她编辑', startedAt: Date.now(), allowFallback: true } };
        return route.fulfill({ status: 202, json: { requestId: input.requestId, status: 'pending', pollUrl: `${path}/${input.requestId}` } });
      }
      if (path.includes('/turns/')) {
        polls++;
        return route.fulfill({ status: 202, json: { requestId: current.activeRequest!.requestId, status: 'pending', pollUrl: path } });
      }
      return route.fulfill({ json: current });
    });
    await page.goto(`${origin}/#/play/${ready.runId}/${ready.branchId}`);
    await expect(page.locator('[data-action="lend_laptop"]')).toBeEnabled();
    await page.locator('[data-action="lend_laptop"]').locator('..').getByRole('button', { name: '换一句自己的话' }).click();
    await page.getByLabel('你的台词').fill(text);
    await page.getByRole('button', { name: '确认收件人与发送' }).click();
    await receivedTurn;
    await expect(page.locator('dialog')).toHaveCount(0);
    await expect(page.locator('.submission-panel')).toBeFocused();
    await expect(page.locator('.dialogue-line p')).toHaveText(ready.visibleEvents.map(event => event.text));
    await expect(page.locator('.submission-panel')).toContainText('正在提交你的动作');
    await expect(page.locator('.submission-panel')).toContainText('把电脑交给她编辑');
    await expect(page.locator('.submission-panel')).toContainText('编剧 · 控台');
    await expect(page.locator('.submission-text')).toHaveText(text);
    await expect(page.locator('.submission-text b')).toHaveCount(0);
    await expect(page.locator('.submission-panel')).toContainText('尚未收到回执');
    await expect(page.locator('[data-action="offer_mic"]')).toBeDisabled();
    await expect(page.locator('.pending-panel')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '用编剧预写接下去' })).toHaveCount(0);
    expect(polls).toBe(0);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].params).toEqual({ target: 'writer', text });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('submitting-action.png'), fullPage: true });
    release();
    if (responseStatus === 200) await expect(page.locator('.scene-title h1')).toHaveText('婚礼现场返工版');
    else await expect(page.locator('.pending-panel')).toContainText('把电脑交给她编辑');
    await expect(page.locator('.submission-panel')).toHaveCount(0);
  });
}

// 引擎只用于模拟服务端，独立访客上下文不证明真实 Cookie 隔离或云端并发。
for (const caseId of ['wedding-01', 'office-01', 'romance-02', 'hiss-01', 'reply-01']) {
  const scenario = acceptance.cases.find(item => item.caseId === caseId);
  if (!scenario) throw new Error(`Missing slow-task acceptance path: ${caseId}`);
  const episodeId = scenario.episodeId as EpisodeId;
  test(`站点模拟：五集慢任务 ${episodeId}，8秒预写、同请求恢复、通关与新访客分享`, async ({ page, browser }, testInfo) => {
    test.setTimeout(60000);
    const store = emptyStore();
    const errors: string[] = [];
    const writes: { method: string; path: string; body: unknown }[] = [];
    const creates: { episodeId: EpisodeId; createKey: string; view: PlayerView }[] = [];
    const submissions: TurnInput[] = [];
    const fallbacks: string[] = [];
    const applied: TurnInput[] = [];
    const reads: { at: number; view: PlayerView }[] = [];
    const polls: { at: number; runId: string; branchId: string; requestId: string; status: number }[] = [];
    let slow: { input: TurnInput; view: PlayerView; completed: boolean } | undefined;
    type PendingTiming = { pendingAt: number; controlsAt: number };
    let timing: PendingTiming | undefined;
    const apiRoot = '/functions/v1/app/api';
    const apply = (runId: string, branchId: string, input: TurnInput) => {
      const next = submitTurn(store, runId, branchId, input);
      applied.push(structuredClone(input));
      return next;
    };
    const handler = async (route: Route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      if (method !== 'GET') writes.push({ method, path, body: request.postDataJSON() });
      if (method === 'GET' && path === `${apiRoot}/episodes`) return route.fulfill({ json: episodes });
      if (method === 'POST' && path === `${apiRoot}/runs`) {
        const input = request.postDataJSON() as { episodeId: EpisodeId; createKey: string };
        expect(input).toEqual({ episodeId, createKey: expect.any(String) });
        const view = createRun(store, input.episodeId, input.createKey);
        creates.push({ ...input, view });
        return route.fulfill({ json: view });
      }
      const match = path.match(/\/api\/runs\/([^/]+)\/branches\/([^/]+)(.*)$/);
      if (!match) throw new Error(`Unexpected simulated API: ${method} ${path}`);
      const [, runId, branchId, suffix] = match;
      const current = readBranch(store, runId, branchId);
      if (method === 'GET' && suffix === '') {
        const view = slow && !slow.completed && slow.view.runId === runId && slow.view.branchId === branchId ? slow.view : current;
        reads.push({ at: Date.now(), view: structuredClone(view) });
        return route.fulfill({ json: view });
      }
      if (method === 'POST' && suffix === '/turns') {
        const input = request.postDataJSON() as TurnInput;
        submissions.push(input);
        expect(runId).toBe(creates[0].view.runId);
        expect(branchId).toBe(creates[0].view.branchId);
        if (submissions.length === 1) {
          const choice = current.choices.find(item => item.actionId === input.actionId)!;
          expect(choice).toBeDefined();
          // 不回填过去时间，也不提前执行：pending 保留真实开场事件和原始 input。
          slow = { input: structuredClone(input), completed: false, view: {
            ...current, status: 'pending', choices: [], activeRequest: {
              requestId: input.requestId, actionId: input.actionId, label: choice.label, startedAt: Date.now(), allowFallback: true,
            },
          } };
          return route.fulfill({ status: 202, json: { requestId: input.requestId, status: 'pending', pollUrl: `${path}/${input.requestId}` } });
        }
        expect(slow?.completed, '等待/刷新不能提交第二个 turn').toBe(true);
        return route.fulfill({ json: apply(runId, branchId, input) });
      }
      if (slow && runId === slow.view.runId && branchId === slow.view.branchId) {
        if (method === 'POST' && suffix === `/turns/${slow.input.requestId}/fallback`) {
          fallbacks.push(suffix.split('/')[2]);
          expect(request.postDataJSON()).toEqual({});
          if (!slow.completed) {
            const completed = apply(runId, branchId, slow.input);
            slow.completed = true;
            return route.fulfill({ json: completed });
          }
          return route.fulfill({ json: current });
        }
        if (method === 'GET' && suffix === `/turns/${slow.input.requestId}`) {
          const status = slow.completed ? 200 : 202;
          polls.push({ at: Date.now(), runId, branchId, requestId: slow.input.requestId, status });
          return route.fulfill({ status, json: slow.completed ? current : { requestId: slow.input.requestId, status: 'pending', pollUrl: path } });
        }
      }
      throw new Error(`Unexpected simulated API: ${method} ${path}`);
    };
    page.on('pageerror', error => errors.push(`player: ${error.message}`));
    await page.setViewportSize({ width: 360, height: 780 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      // 固定走真实分享 UI 的只读输入，不申请剪贴板权限、不手造分享地址。
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
      const timing = { pendingAt: 0, controlsAt: 0 };
      Object.assign(window, { slowTaskTiming: timing });
      // 从首次渲染起记录控制项出现时间，避免只在第8秒后取样而漏掉提前出现。
      new MutationObserver(() => {
        if (!timing.pendingAt && document.querySelector('.pending-panel')) timing.pendingAt = Date.now();
        if (!timing.controlsAt && document.querySelector('.pending-panel .inline-buttons')) timing.controlsAt = Date.now();
      }).observe(document, { childList: true, subtree: true });
    });
    await page.route(api, handler);
    try {
      await page.goto(origin);
      await expect(page.locator('.poster-card')).toHaveCount(5);
      await expect(page.locator('.mode-pill')).toHaveText('在线演出');
      await expect(page.getByRole('button', { name: '开启声音', exact: true })).toHaveAttribute('aria-pressed', 'false');
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.evaluate(() => localStorage.getItem('retake.progress.site'))).toBeNull();
      await page.locator(`[data-episode="${episodeId}"]`).click();
      await expect(page.locator(`[data-action="${scenario.turns[0].actionId}"]`)).toBeEnabled();
      expect(creates).toHaveLength(1);
      const opening = creates[0].view;
      const branchPath = `${apiRoot}/runs/${opening.runId}/branches/${opening.branchId}`;
      await expect(page).toHaveURL(`${origin}/#/play/${opening.runId}/${opening.branchId}`);
      expect(opening).toMatchObject({ episodeId, revision: 0, stage: 1, status: 'ready', ending: null });
      await expect(page.locator('.dialogue-line p')).toHaveText(opening.visibleEvents.map(event => event.text));

      async function choose(turn: { stage: number; actionId: string }) {
        const view = readBranch(store, opening.runId, opening.branchId);
        const choice = view.choices.find(item => item.actionId === turn.actionId)!;
        expect(choice).toBeDefined();
        const before = submissions.length;
        let params: TurnInput['params'] = choice.targets?.length ? { target: choice.targets[0].id } : {};
        if (episodeId === 'hiss' && turn.stage === 2) {
          await expect(page.getByRole('combobox')).toHaveValue('cat_hiss');
          params.sample = 'cat_hiss';
        }
        const button = page.locator(`[data-action="${turn.actionId}"]`);
        await expect(button).toBeEnabled();
        await button.click();
        if (episodeId === 'reply' && choice.control === 'message') {
          const parent = view.visibleEvents.find(event => event.eventId === view.presentation[`${turn.actionId}ParentMessageId`])!;
          const target = choice.targets![0];
          const draft = page.getByRole('dialog', { name: '确认引用这条消息' });
          await expect(draft).toBeVisible();
          await expect(draft.locator('.quote-parent p')).toHaveText(parent.text);
          await expect(draft.getByLabel('发送正文')).toHaveValue('1');
          await expect(draft.getByLabel('发送正文')).toHaveAttribute('readonly', '');
          expect(submissions).toHaveLength(before);
          params = { parentMessageId: parent.eventId, target: target.id, channel: target.channel, text: '1' };
          await expect(draft.locator('[data-confirm-quote]')).toBeEnabled();
          await draft.locator('[data-confirm-quote]').click();
        }
        if (turn.actionId === 'ask_friend') {
          const original = view.visibleEvents.find(event => event.eventId === view.presentation.friendForwardPreviewEventId)!;
          const draft = page.getByRole('dialog', { name: '确认转发给阿圆' });
          await expect(draft).toBeVisible();
          await expect(draft.locator('.forward-preview p')).toHaveText(original.text);
          await expect(draft).toContainText('不包含其他窗口或未发送草稿');
          expect(submissions).toHaveLength(before);
          params = { forwardEventId: original.eventId, target: 'friend', channel: 'friend' };
          await expect(draft.locator('[data-confirm-forward]')).toBeEnabled();
          await draft.locator('[data-confirm-forward]').click();
        }
        await expect.poll(() => submissions.length).toBe(before + 1);
        expect(submissions[before]).toEqual({ requestId: expect.any(String), expectedRevision: view.revision, ...turn, params });
      }

      await choose(scenario.turns[0]);
      const originalInput = structuredClone(submissions[0]);
      const active = structuredClone(slow!.view.activeRequest!);
      if (episodeId === 'wedding') expect(active.label).toBe('拖到片尾预览');
      const pending = page.locator('.pending-panel');
      const fallback = page.getByRole('button', { name: '用编剧预写接下去', exact: true });
      const keepWaiting = page.getByRole('button', { name: '继续等', exact: true });
      await expect(pending).toContainText(active.label);
      await expect(pending).toContainText('演员正在接戏');
      await expect(pending).toContainText('离开或刷新后，可以回来继续这一拍');
      await expect(page.locator('.dialogue-line p')).toHaveText(opening.visibleEvents.map(event => event.text));
      await expect(page.locator('[data-action]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '倒带', exact: true })).toBeDisabled();
      await expect(fallback).toHaveCount(0);
      await expect(keepWaiting).toHaveCount(0);
      expect(slow!.view).toMatchObject({ revision: 0, choices: [], activeRequest: { ...active, allowFallback: true } });
      expect(applied).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBeNull();

      // 真实浏览器时钟：7秒处仍没有选项，首次出现必须在真实 startedAt + 8秒之后。
      await page.waitForFunction(startedAt => Date.now() - startedAt >= 7000, active.startedAt, { timeout: 10000 });
      const beforeThreshold = await page.evaluate(startedAt => ({ elapsed: Date.now() - startedAt, buttons: document.querySelectorAll('.pending-panel button').length }), active.startedAt);
      expect(beforeThreshold.elapsed).toBeLessThan(8000);
      expect(beforeThreshold.buttons).toBe(0);
      await expect(fallback).toBeVisible({ timeout: 5000 });
      await expect(fallback).toBeEnabled();
      await expect(keepWaiting).toBeEnabled();
      timing = await page.evaluate(() => (window as unknown as { slowTaskTiming: PendingTiming }).slowTaskTiming);
      expect(timing.pendingAt).toBeGreaterThanOrEqual(active.startedAt);
      expect(timing.controlsAt - active.startedAt).toBeGreaterThanOrEqual(8000);
      expect(timing.controlsAt - active.startedAt).toBeLessThan(11000);
      await expect(pending).toContainText(active.label);
      await expect(page.getByRole('button', { name: '倒带', exact: true })).toBeDisabled();
      await page.screenshot({ path: testInfo.outputPath(`${episodeId}-slow-task.png`), fullPage: true });

      if (episodeId === 'wedding') {
        // 第8次请求可区分3秒封顶与持续增长的退避；每段允许1秒调度开销。
        const delays = [1000, 1500, 2000, 2500, 3000, 3000, 3000, 3000];
        await expect.poll(() => polls.length, { timeout: 30000, intervals: [100, 250, 500] }).toBeGreaterThanOrEqual(delays.length);
        const pendingRead = reads.find(read => read.view.status === 'pending')!;
        for (const [index, delay] of delays.entries()) {
          const interval = polls[index].at - (index ? polls[index - 1].at : pendingRead.at);
          expect(interval, `poll ${index + 1}: expected about ${delay}ms`).toBeGreaterThanOrEqual(delay - 150);
          expect(interval, `poll ${index + 1}: expected about ${delay}ms`).toBeLessThanOrEqual(delay + 1000);
        }
      }
      expect(polls.length).toBeGreaterThan(0);
      expect(polls.every(poll => poll.requestId === originalInput.requestId && poll.runId === opening.runId && poll.branchId === opening.branchId && poll.status === 202)).toBe(true);

      const readsBeforeReload = reads.length;
      await page.reload();
      await expect(pending).toContainText(active.label);
      await expect(page.locator('[data-action]')).toHaveCount(0);
      await expect(page.locator('.dialogue-line p')).toHaveText(opening.visibleEvents.map(event => event.text));
      await expect(page.getByRole('button', { name: '倒带', exact: true })).toBeDisabled();
      await expect(fallback).toBeEnabled();
      expect(reads.length).toBeGreaterThan(readsBeforeReload);
      expect(reads.slice(readsBeforeReload).map(read => read.view.activeRequest)).toEqual([active]);
      const pollsAfterReload = polls.length;
      await expect.poll(() => polls.length).toBeGreaterThan(pollsAfterReload);
      expect(polls.at(-1)).toMatchObject({ runId: opening.runId, branchId: opening.branchId, requestId: originalInput.requestId, status: 202 });
      expect(submissions).toEqual([originalInput]);
      expect(creates).toHaveLength(1);
      expect(applied).toEqual([]);
      const waitingWrites = structuredClone(writes);
      await keepWaiting.click();
      await expect(page.locator('.toast[role="status"]')).toContainText('会继续等待，回来时自动查询');
      await expect(pending).toContainText(active.label);
      expect(writes).toEqual(waitingWrites);
      expect(readBranch(store, opening.runId, opening.branchId)).toEqual(opening);

      await fallback.click();
      const nextAction = page.locator(`[data-action="${scenario.turns[1].actionId}"]`);
      await expect(nextAction).toBeEnabled();
      await expect(pending).toHaveCount(0);
      const completed = readBranch(store, opening.runId, opening.branchId);
      expect(completed).toMatchObject({ revision: 1, stage: scenario.turns[1].stage, status: 'ready', activeRequest: null });
      expect(completed.visibleEvents.filter(event => event.stage === 1 && ['player_action', 'reply_sent'].includes(event.kind))).toHaveLength(1);
      expect(completed.visibleEvents.every(event => event.source === 'authored' || event.source === 'rules')).toBe(true);
      await expect(page.locator('.dialogue-line .dialogue-meta small')).toHaveText(completed.visibleEvents.map(event => event.source === 'authored' ? '编剧预写' : '现场规则'));
      await page.reload();
      await expect(nextAction).toBeEnabled();
      await expect(page.locator('.dialogue-line p')).toHaveText(completed.visibleEvents.map(event => event.text));
      expect(reads.at(-1)!.view).toEqual(completed);
      expect(submissions).toHaveLength(1);
      expect(fallbacks).toEqual(submissions.map(input => input.requestId));
      expect(applied).toEqual([originalInput]);
      expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBeNull();

      for (const turn of scenario.turns.slice(1)) await choose(turn);
      await expect(page.locator('.scene-title h1')).toHaveText(scenario.expected.title);
      await expect(page.locator('.scene-title')).toContainText(scenario.expected.visibleResult);
      const ended = readBranch(store, opening.runId, opening.branchId);
      expect(ended).toMatchObject({ revision: scenario.turns.length, status: 'ended', activeRequest: null, ending: { id: scenario.expected.endingId, title: scenario.expected.title, text: scenario.expected.visibleResult } });
      for (const kind of scenario.expected.requiredEvents) expect(ended.visibleEvents.some(event => event.kind === kind)).toBe(true);
      expect(ended.visibleEvents.every(event => event.source === 'authored' || event.source === 'rules')).toBe(true);
      expect(new Set(ended.visibleEvents.map(event => event.eventId)).size).toBe(ended.visibleEvents.length);
      await expect(page.locator('.dialogue-line p')).toHaveText(ended.visibleEvents.map(event => event.text));
      await expect(page.locator('.dialogue-line .dialogue-meta small')).toHaveText(ended.visibleEvents.map(event => event.source === 'authored' ? '编剧预写' : '现场规则'));
      await expect(page.locator('.dialogue')).not.toContainText('现场接戏');
      await expect(page.locator('.scene-title .last-line')).toHaveText(`“${ended.ending!.line}”`);
      const saved = await page.evaluate(() => localStorage.getItem('retake.progress.site'));
      const endingWrites = structuredClone(writes);
      await page.reload();
      await expect(page.locator('.scene-title h1')).toHaveText(scenario.expected.title);
      await expect(page.locator('.scene-title')).toContainText(scenario.expected.visibleResult);
      await expect(page.locator('.dialogue-line p')).toHaveText(ended.visibleEvents.map(event => event.text));
      expect(reads.at(-1)!.view).toEqual(ended);
      expect(writes).toEqual(endingWrites);
      expect(await page.evaluate(() => localStorage.getItem('retake.progress.site'))).toBe(saved);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole('button', { name: '开启声音', exact: true })).toHaveAttribute('aria-pressed', 'false');

      await page.getByRole('button', { name: '分享开场', exact: true }).click();
      const link = page.getByLabel('手动复制开场链接');
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('readonly', '');
      const shareURL = await link.inputValue();
      expect(shareURL).toBe(`${origin}/#/episode/${episodeId}`);
      for (const id of [opening.runId, opening.branchId, creates[0].createKey, ...submissions.map(input => input.requestId), ...ended.checkpoints.map(checkpoint => checkpoint.id)]) expect(shareURL).not.toContain(id);
      expect(writes).toEqual(endingWrites);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      const visitor = await browser.newContext({ viewport: { width: 360, height: 780 }, reducedMotion: 'reduce' });
      try {
        expect(await visitor.storageState()).toEqual({ cookies: [], origins: [] });
        await visitor.route(api, handler);
        const fresh = await visitor.newPage();
        fresh.on('pageerror', error => errors.push(`visitor: ${error.message}`));
        const previousReads = reads.length;
        await fresh.goto(shareURL);
        await expect(fresh.locator(`[data-action="${scenario.turns[0].actionId}"]`)).toBeEnabled();
        expect(creates).toHaveLength(2);
        const newOpening = creates[1].view;
        expect(creates[1].createKey).not.toBe(creates[0].createKey);
        expect(newOpening.runId).not.toBe(opening.runId);
        expect(newOpening.branchId).not.toBe(opening.branchId);
        expect(newOpening).toMatchObject({ episodeId, revision: 0, stage: 1, status: 'ready', activeRequest: null, ending: null, checkpoints: [], inventory: [] });
        expect(newOpening.branches).toEqual([{ branchId: newOpening.branchId, parentBranchId: null, label: '第一遍', endingTitle: null }]);
        await expect(fresh).toHaveURL(`${origin}/#/play/${newOpening.runId}/${newOpening.branchId}`);
        await expect(fresh.locator('.scene-title h1')).toHaveText(opening.scene.title);
        await expect(fresh.locator('.dialogue-line p')).toHaveText(opening.visibleEvents.map(event => event.text));
        await expect(fresh.locator('.ending-panel, .pending-panel, .last-line')).toHaveCount(0);
        await expect(fresh.locator('.play-page')).not.toContainText(scenario.expected.title);
        await expect(fresh.getByRole('button', { name: '倒带', exact: true })).toBeDisabled();
        await expect(fresh.getByRole('button', { name: '开启声音', exact: true })).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(() => reads.length).toBeGreaterThan(previousReads);
        expect(reads.slice(previousReads).every(read => read.view.runId === newOpening.runId && read.view.revision === 0 && read.view.ending === null)).toBe(true);
        expect(newOpening.visibleEvents.every(event => !ended.visibleEvents.some(old => old.eventId === event.eventId))).toBe(true);
        expect(await fresh.evaluate(() => JSON.parse(localStorage.getItem('retake.progress.site')!))).toEqual({ [episodeId]: { runId: newOpening.runId, branchId: newOpening.branchId } });
        expect(await fresh.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBeNull();
        expect(await fresh.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
        expect(await fresh.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      } finally {
        await visitor.close();
      }
      expect(readBranch(store, opening.runId, opening.branchId)).toEqual(ended);
      expect(await page.evaluate(() => localStorage.getItem('retake.progress.site'))).toBe(saved);
      expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBeNull();
      expect(submissions).toHaveLength(scenario.turns.length);
      expect(new Set(submissions.map(input => input.requestId)).size).toBe(scenario.turns.length);
      expect(fallbacks).toEqual([originalInput.requestId]);
      expect(applied).toEqual(submissions);
      expect(applied.filter(input => input.requestId === originalInput.requestId)).toEqual([originalInput]);
      expect(writes.map(write => `${write.method} ${write.path}`)).toEqual([
        `POST ${apiRoot}/runs`, `POST ${branchPath}/turns`, `POST ${branchPath}/turns/${originalInput.requestId}/fallback`,
        ...scenario.turns.slice(1).map(() => `POST ${branchPath}/turns`), `POST ${apiRoot}/runs`,
      ]);
      expect(errors).toEqual([]);
    } finally {
      await testInfo.attach(`${episodeId}-simulated-requests`, {
        contentType: 'application/json',
        body: JSON.stringify({ caseId, boundary: 'client simulation only; not cookie ownership or cloud concurrency', timing, startedAt: slow?.view.activeRequest?.startedAt, writes, submissions, fallbacks, applied, polls, reads: reads.map(({ at, view }) => ({ at, runId: view.runId, branchId: view.branchId, revision: view.revision, requestId: view.activeRequest?.requestId, status: view.status })), errors }, null, 2),
      });
    }
  });
}

test('站点模拟：断网后重试保留requestId与玩家原选择', async ({ page }) => {
  const ready = structuredClone(previewViews.ready);
  let current = ready;
  let fail = true;
  const inputs: TurnInput[] = [];
  await page.route(api, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/episodes')) return route.fulfill({ json: episodes });
    if (path.endsWith('/api/runs')) return route.fulfill({ json: ready });
    if (path.endsWith('/turns')) {
      inputs.push(route.request().postDataJSON() as TurnInput);
      if (fail) { fail = false; return route.abort('internetdisconnected'); }
      current = { ...structuredClone(previewViews.rewind), branchId: ready.branchId, revision: 1, branches: ready.branches };
    }
    return route.fulfill({ json: current });
  });
  await page.goto(`${origin}/#/episode/wedding`);
  await expect(page.locator('[data-action="preview_tail"]')).toBeEnabled();
  await page.locator('[data-action="preview_tail"]').click();
  await expect(page.getByRole('alert')).toContainText('网络');
  await expect(page.locator('.submission-panel')).toContainText('这次操作尚未确认');
  await expect(page.locator('.submission-panel')).toContainText('拖到片尾预览');
  await expect(page.locator('[data-action="hold_photos"]')).toBeDisabled();
  await page.getByRole('button', { name: '重试原操作' }).click();
  await expect(page.locator('[data-action="private_preview"]')).toBeEnabled();
  expect(inputs).toHaveLength(2);
  expect(inputs[1]).toEqual(inputs[0]);
});
