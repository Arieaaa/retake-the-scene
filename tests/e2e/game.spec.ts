import { expect, test } from '@playwright/test';
import acceptance from '../../五剧十五结局-验收样例.json' with { type: 'json' };
import type { AuthoredStore } from '../../fixtures/authored-engine';
import type { TurnInput } from '../../shared/contracts';

for (const scenario of acceptance.cases) {
  test(`作者预演 ${scenario.caseId}: ${scenario.expected.title}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('.poster-card')).toHaveCount(5);
    await page.locator(`[data-episode="${scenario.episodeId}"]`).click();
    await expect(page.locator('.action-panel')).toBeVisible();
    const openingCount = await page.locator('.dialogue-line').count();
    let firstChangeText = '';
    for (const [index, turn] of scenario.turns.entries()) {
      const choice = page.locator(`[data-action="${turn.actionId}"]`);
      await expect(choice).toBeEnabled();
      await choice.click();
      if (scenario.episodeId === 'reply' && /^(quote_|reply_)/.test(turn.actionId)) {
        await expect(page.getByRole('dialog', { name: '确认引用这条消息' })).toBeVisible();
        const confirm = page.locator('button[data-confirm-quote]');
        await expect(confirm).toBeEnabled();
        await confirm.click();
      }
      if (turn.actionId === 'ask_friend') {
        await expect(page.getByRole('dialog', { name: '确认转发给阿圆' })).toBeVisible();
        const confirm = page.locator('button[data-confirm-forward]');
        await expect(confirm).toBeEnabled();
        await confirm.click();
      }
      if (index === 0) {
        await expect(page.locator('.action-panel')).toBeVisible();
        firstChangeText = await page.locator('.dialogue-line p').nth(openingCount + (scenario.episodeId === 'hiss' ? 0 : 1)).innerText();
      }
    }
    await expect(page.locator('.scene-title .last-line')).toBeFocused();
    await expect(page.locator('.ending-change-text')).toHaveText(firstChangeText);
    await expect(page.locator('.scene-title h1')).toHaveText(scenario.expected.title);
    await expect(page.locator('.scene-title')).toContainText(scenario.expected.visibleResult);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByLabel('开启声音')).toBeVisible();
    await expect(page.locator('.dialogue')).not.toContainText('现场接戏');
    const props: Record<string, string> = {
      'wedding.fish': 'fish-and-mic', 'wedding.on_time': 'green-handover',
      'office.rest': 'meeting-minutes', 'office.handover': 'signed-hours',
      'hiss.back': 'player-performance', 'hiss.cover': 'player-performance', 'hiss.duet': 'player-performance',
      'reply.bucket': 'bucket-returned',
    };
    if (props[scenario.expected.endingId]) await expect(page.locator(`[data-prop="${props[scenario.expected.endingId]}"]`)).toHaveCount(1);
    if (scenario.expected.endingId === 'wedding.credits') {
      await expect(page.locator('.prop-bottom')).toContainText('本人已确认署名');
      await expect(page.locator('.prop-bottom')).not.toContainText('少了一行');
    }
    if (scenario.expected.endingId === 'romance.bbq') {
      await expect(page.locator('.stage .prop-panel')).toContainText('原稿 · 已发给汽水');
      await expect(page.locator('.stage .prop-panel')).not.toContainText('未发送');
      await expect(page.locator('#chat-coach')).toHaveClass(/inactive-chat/);
      await expect(page.locator('#chat-coach')).not.toContainText('另两家我取消');
    }
    if (scenario.expected.endingId === 'hiss.cover') await expect(page.locator('.cover-comment')).toContainText('左边那只怎么穿衣服');
    if (scenario.expected.endingId === 'hiss.duet') await expect(page.locator('.duet-title')).toHaveText('耄耋独唱，特邀嘉宾负责挨哈');
    if (scenario.expected.endingId === 'reply.screen') await expect(page.locator('[data-prop="court-avatar"]')).toHaveCount(9);
    if (scenario.expected.endingId === 'reply.class') await expect(page.locator('.typing-avatars > span')).toHaveCount(37);
    if (process.env.CAPTURE_EVIDENCE) {
      await page.screenshot({ path: `docs/evidence/${scenario.caseId}-mobile.png`, fullPage: true });
      if (['wedding-01', 'romance-03', 'hiss-02'].includes(scenario.caseId)) {
        const downloaded = page.waitForEvent('download');
        await page.getByRole('button', { name: '保存这张剧照' }).click();
        const cover = await downloaded;
        expect(await cover.failure()).toBeNull();
        await cover.saveAs(`docs/evidence/${scenario.caseId}-cover.png`);
      }
    }
    await page.reload();
    await expect(page.locator('.scene-title h1')).toHaveText(scenario.expected.title);
    await expect(page.locator('.ending-change-text')).toHaveText(firstChangeText);
    expect(errors).toEqual([]);
  });
}

for (const episodeId of ['wedding', 'office', 'romance', 'hiss', 'reply']) {
  const scenario = acceptance.cases.find(item => item.episodeId === episodeId);
  if (!scenario) throw new Error(`Missing keyboard acceptance path: ${episodeId}`);
  test(`全程Tab与Enter：${episodeId}片单到结局，静音且减少动画`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    async function activate(selector: string) {
      const button = page.locator(selector);
      await expect(button).toBeEnabled();
      for (let tabs = 0; tabs < 40 && !await button.evaluate(element => element === document.activeElement); tabs++) {
        await page.keyboard.press('Tab');
      }
      await expect(button).toBeFocused();
      await page.keyboard.press('Enter');
    }
    await activate(`[data-episode="${episodeId}"]`);
    for (const turn of scenario.turns) {
      await activate(`[data-action="${turn.actionId}"]`);
      if (episodeId === 'reply' && /^(quote_|reply_)/.test(turn.actionId)) {
        await expect(page.getByRole('dialog', { name: '确认引用这条消息' })).toBeVisible();
        await activate('button[data-confirm-quote]');
      }
      if (turn.actionId === 'ask_friend') {
        await expect(page.getByRole('dialog', { name: '确认转发给阿圆' })).toBeVisible();
        await activate('button[data-confirm-forward]');
      }
    }
    await expect(page.locator('.scene-title h1')).toHaveText(scenario.expected.title);
    await expect(page.locator('.scene-title')).toContainText(scenario.expected.visibleResult);
    await expect(page.getByLabel('开启声音')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('扣1引用草稿可撤回改选，确认前不落拍且正文固定', async ({ page }, testInfo) => {
  await page.goto('/#/episode/reply');
  await expect(page.locator('[data-action="quote_clip"]')).toBeEnabled();
  const saved = await page.evaluate(() => localStorage.getItem('retake.authored.v1'));
  await page.locator('[data-action="quote_clip"]').click();
  const draft = page.getByRole('dialog', { name: '确认引用这条消息' });
  await expect(draft).toBeVisible();
  await expect(draft.locator('.quote-parent')).toContainText('扣 1 复活完整版');
  await expect(draft.getByLabel('发送正文')).toHaveValue('1');
  await expect(draft.getByLabel('发送正文')).toHaveAttribute('readonly', '');
  expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBe(saved);
  await draft.getByRole('button', { name: '撤回草稿，重新选楼' }).click();
  await expect(page.locator('[data-action="quote_game"]')).toBeEnabled();
  await page.locator('[data-action="quote_game"]').click();
  await expect(draft.locator('.quote-parent')).toContainText('周六打球差一个');
  await expect(draft).toContainText('球友的球局楼');
  expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBe(saved);
  await page.screenshot({ path: process.env.CAPTURE_EVIDENCE ? 'docs/evidence/reply-draft.png' : testInfo.outputPath('reply-draft.png') });
  await draft.getByRole('button', { name: '确认引用并发送 1' }).click();
  await expect(page.locator('[data-action="inspect_frame"]')).toBeEnabled();
  await page.locator('[data-action="inspect_frame"]').click();
  await expect(page.locator('[data-action="reply_game"]')).toBeEnabled();
  const beforeFinal = await page.evaluate(() => localStorage.getItem('retake.authored.v1'));
  await page.locator('[data-action="reply_game"]').click();
  await expect(draft).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBe(beforeFinal);
  await page.locator('[data-action="reply_homework"]').click();
  await expect(draft).toContainText('课代表的订正楼');
  await draft.getByRole('button', { name: '确认引用并发送 1' }).click();
  await expect(page.locator('.scene-title h1')).toHaveText('成功复活全群');
  const { replies, parents } = await page.evaluate(() => {
    const [, , runId, branchId] = location.hash.split('/');
    const state = JSON.parse(localStorage.getItem('retake.authored.v1')!).store.runs[runId].branches[branchId].state;
    return { replies: state.visibleEvents.filter((event: { kind: string }) => event.kind === 'reply_sent') as { text: string; causeIds: string[] }[], parents: [state.presentation.quote_gameParentMessageId, state.presentation.reply_homeworkParentMessageId] as string[] };
  });
  expect(replies).toHaveLength(2);
  expect(replies.map(event => event.text)).toEqual(['1', '1']);
  expect(replies[0].causeIds).toContain(parents[0]);
  expect(replies[1].causeIds).toContain(parents[1]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('倒回首拍后仍能从界面对照与回看旧线，不提交新动作', async ({ page }, testInfo) => {
  await page.goto('/#/episode/wedding');
  for (const action of ['preview_tail', 'private_preview', 'lend_laptop']) {
    await expect(page.locator(`[data-action="${action}"]`)).toBeEnabled();
    await page.locator(`[data-action="${action}"]`).click();
  }
  await expect(page.locator('.scene-title h1')).toHaveText('婚礼现场返工版');
  const oldRoute = page.url();
  const oldEvents = await page.locator('.dialogue-line p').allTextContents();
  await page.getByRole('button', { name: '倒回去，换个演法' }).click();
  await page.locator('.rewind-list').first().getByRole('button').first().click();
  await expect(page.locator('[data-action="preview_tail"]')).toBeEnabled();
  const saved = await page.evaluate(() => localStorage.getItem('retake.authored.v1'));
  await page.reload();
  const rewind = page.getByRole('button', { name: '倒带', exact: true });
  await expect(rewind).toBeEnabled();
  await rewind.click();
  await expect(page.locator('dialog')).toContainText('这条线还没有可倒带的决策点');
  await expect(page.locator('.rewind-list').first().getByRole('button')).toHaveCount(0);
  await page.getByRole('button', { name: '对照：婚礼现场返工版' }).click();
  await expect(page.locator('.branch-compare')).toContainText('玩家可见的第一处差异');
  await page.screenshot({ path: process.env.CAPTURE_EVIDENCE ? 'docs/evidence/first-beat-replay.png' : testInfo.outputPath('first-beat-replay.png') });
  await page.locator('.rewind-list').nth(1).getByRole('button', { name: /婚礼现场返工版/ }).click();
  await expect(page).toHaveURL(oldRoute);
  await expect(page.locator('.dialogue-line p')).toHaveText(oldEvents);
  expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBe(saved);
});

for (const operation of ['fork', 'new']) {
  test(`片单保留上次结局并继续未结束的新线：${operation}`, async ({ page }) => {
    await page.goto('/#/episode/wedding');
    for (const action of ['preview_tail', 'private_preview', 'lend_laptop']) {
      await expect(page.locator(`[data-action="${action}"]`)).toBeEnabled();
      await page.locator(`[data-action="${action}"]`).click();
    }
    await expect(page.locator('.scene-title h1')).toHaveText('婚礼现场返工版');
    if (operation === 'fork') {
      await page.getByRole('button', { name: '倒回去，换个演法' }).click();
      await page.locator('.rewind-list').first().getByRole('button').first().click();
    } else await page.getByRole('button', { name: '另开一局', exact: true }).click();
    await expect(page.locator('[data-action="preview_tail"]')).toBeEnabled();
    const currentRoute = page.url();
    await page.getByRole('button', { name: '回片单', exact: true }).click();
    await expect(page.locator('[data-episode="wedding"]')).toContainText('上次收场：婚礼现场返工版');
    await page.reload();
    await expect(page.locator('[data-episode="wedding"]')).toContainText('上次收场：婚礼现场返工版');
    await page.locator('[data-episode="wedding"]').click();
    await expect(page).toHaveURL(currentRoute);
    await expect(page.locator('[data-action="preview_tail"]')).toBeEnabled();
    for (const action of ['hold_photos', 'watch_table', 'offer_mic']) {
      await expect(page.locator(`[data-action="${action}"]`)).toBeEnabled();
      await page.locator(`[data-action="${action}"]`).click();
    }
    await expect(page.locator('.scene-title h1')).toHaveText('这桌先上鱼');
    await page.getByRole('button', { name: '回片单', exact: true }).click();
    await expect(page.locator('[data-episode="wedding"]')).toContainText('上次收场：这桌先上鱼');
  });
}

test('婚礼倒带不继承同意，旧结局保留，分享不泄露存档', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.locator('[data-episode="wedding"]').click();
  for (const action of ['preview_tail', 'private_preview', 'lend_laptop']) { await expect(page.locator(`[data-action="${action}"]`)).toBeEnabled(); await page.locator(`[data-action="${action}"]`).click(); }
  await expect(page.locator('.scene-title h1')).toHaveText('婚礼现场返工版');
  const oldRoute = page.url();
  await page.getByRole('button', { name: '分享开场' }).click();
  const share = await page.evaluate(() => navigator.clipboard.readText());
  expect(share).toMatch(/#\/episode\/wedding$/); expect(share).not.toContain('play/');
  const visitor = await context.browser()!.newContext({ viewport: { width: 360, height: 780 } });
  const fresh = await visitor.newPage(); await fresh.goto(share);
  await expect(fresh.locator('[data-action="preview_tail"]')).toBeEnabled();
  await visitor.close();
  await page.getByRole('button', { name: '倒回去，换个演法' }).click();
  await page.locator('.rewind-list').first().getByRole('button').nth(1).click();
  await expect(page.locator('[data-action="watch_table"]')).toBeEnabled();
  await page.locator('[data-action="watch_table"]').click();
  await expect(page.locator('[data-action="offer_mic"]')).toBeEnabled();
  await expect(page.locator('[data-action="lend_laptop"]')).toHaveCount(0);
  await page.locator('[data-action="offer_mic"]').click();
  await expect(page.locator('.scene-title h1')).toHaveText('这桌先上鱼');
  await page.goto(oldRoute);
  await expect(page.locator('.scene-title h1')).toHaveText('婚礼现场返工版');
});

test('结局另开一局回到开场，刷新可恢复且旧局仍可读取', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/episode/wedding');
  for (const action of ['preview_tail', 'private_preview', 'lend_laptop']) {
    await expect(page.locator(`[data-action="${action}"]`)).toBeEnabled();
    await page.locator(`[data-action="${action}"]`).click();
  }
  await expect(page.locator('.scene-title h1')).toHaveText('婚礼现场返工版');
  const oldRoute = page.url();
  await page.getByRole('button', { name: '另开一局', exact: true }).click();
  await expect(page.locator('[data-action="preview_tail"]')).toBeEnabled();
  await expect(page).not.toHaveURL(oldRoute);
  await page.reload();
  await expect(page.locator('[data-action="preview_tail"]')).toBeEnabled();
  await page.goto(oldRoute);
  await expect(page.locator('.scene-title h1')).toHaveText('婚礼现场返工版');
  expect(errors).toEqual([]);
});

test('猫样本不匹配可重录，自由姿态与静音不依赖麦克风', async ({ page }) => {
  await page.goto('/#/episode/hiss');
  await expect(page.locator('[data-action="custom_gesture"]')).toBeEnabled();
  await page.locator('[data-action="custom_gesture"]').click();
  await page.getByLabel('你的动作').fill('我往后退一步，静静看着它');
  await page.getByRole('button', { name: '确认行动' }).click();
  await expect(page.locator('[data-action="bind_back"]')).toBeEnabled();
  await page.getByRole('combobox').selectOption('player_word');
  await page.locator('[data-action="bind_back"]').click();
  await expect(page.locator('[data-action="bow"]')).toBeEnabled();
  await page.locator('[data-action="bow"]').click();
  await expect(page.locator('[data-action="bind_back"]')).toBeEnabled();
  await page.getByRole('combobox').selectOption('cat_hiss');
  await page.locator('[data-action="bind_back"]').click();
  await expect(page.locator('[data-action="bow"]')).toBeEnabled();
  await page.locator('[data-action="bow"]').click();
  await expect(page.locator('.scene-title h1')).toHaveText('我先哈一步');
  await page.getByRole('button', { name: '默默删掉' }).click();
  await expect(page.locator('.fictional-comments')).toContainText('默默删掉了草稿');
});

test('猫回环后完整对白可回看，倒带与旧线各保留自己的记录', async ({ page }) => {
  await page.goto('/#/episode/hiss');
  await expect(page.locator('[data-action="step_back"]')).toBeEnabled();
  const opening = await page.locator('.dialogue-line p').allTextContents();
  await page.locator('[data-action="step_back"]').click();
  await expect(page.locator('[data-action="bind_back"]')).toBeEnabled();
  await page.getByRole('combobox').selectOption('player_word');
  for (let loop = 0; loop < 2; loop++) {
    await page.locator('[data-action="bind_back"]').click();
    await expect(page.locator('[data-action="bow"]')).toBeEnabled();
    await page.locator('[data-action="bow"]').click();
    await expect(page.locator('[data-action="bind_back"]')).toBeEnabled();
  }
  await page.getByRole('combobox').selectOption('cat_hiss');
  await page.locator('[data-action="bind_back"]').click();
  await expect(page.locator('[data-action="bow"]')).toBeEnabled();
  await page.locator('[data-action="bow"]').click();
  await expect(page.locator('.scene-title h1')).toHaveText('我先哈一步');
  const oldRoute = page.url();
  const saved = await page.evaluate(() => localStorage.getItem('retake.authored.v1'));
  const expected = await page.evaluate(() => {
    const [, , runId, branchId] = location.hash.split('/');
    const data = JSON.parse(localStorage.getItem('retake.authored.v1')!);
    return data.store.runs[runId].branches[branchId].state.visibleEvents.map((event: { text: string }) => event.text) as string[];
  });
  expect(expected.length).toBeGreaterThan(8);
  expect(expected.slice(0, opening.length)).toEqual(opening);
  await expect(page.locator('.dialogue-line p')).toHaveText(expected);
  await page.getByRole('button', { name: /^已获物证/ }).click();
  await expect(page.locator('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('.dialogue-line p')).toHaveText(expected);
  expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBe(saved);
  await page.getByRole('button', { name: '倒回去，换个演法' }).click();
  await page.locator('.rewind-list').first().getByRole('button').first().click();
  await expect(page.locator('[data-action="step_back"]')).toBeEnabled();
  await expect(page.locator('.dialogue-line p')).toHaveText(opening);
  await page.goto(oldRoute);
  await expect(page.locator('.dialogue-line p')).toHaveText(expected);
});

test('阿圆转发先预览，取消与Escape不落盘，键盘确认只交付一条历史和附言', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/episode/romance');
  await expect(page.locator('.mode-pill')).toHaveText('编剧预写 · 本机存档');
  await expect(page.locator('[data-action="ask_friend"]')).toBeEnabled();
  await expect(page).toHaveURL(/#\/play\/[^/]+\/[^/]+$/);
  await expect(page.getByLabel('开启声音')).toBeVisible();

  async function readSave() {
    return page.evaluate(() => {
      const saved = localStorage.getItem('retake.authored.v1')!;
      const [, , runId, branchId] = location.hash.split('/');
      const { store } = JSON.parse(saved) as { store: AuthoredStore };
      const branch = store.runs[runId].branches[branchId];
      return { saved, state: branch.state, inputs: Object.values(branch.requests).map(request => JSON.parse(request.fingerprint) as TurnInput) };
    });
  }
  async function activate(selector: string) {
    const button = page.locator(selector);
    await expect(button).toBeEnabled();
    for (let tabs = 0; tabs < 40 && !await button.evaluate(element => element === document.activeElement); tabs++) {
      await page.keyboard.press('Tab');
    }
    await expect(button).toBeFocused();
    await page.keyboard.press('Enter');
  }
  const opening = await readSave();
  expect(opening.state.episodeId).toBe('romance');
  expect(opening.state.revision).toBe(0);
  const original = opening.state.visibleEvents.find(event => event.eventId === opening.state.presentation.friendForwardPreviewEventId
    && event.actorId === 'soda' && event.audience.includes('player') && ['soda', 'coach'].includes(event.channel))!;
  expect(original, '预览必须引用本局真实开场投影中的消息，不使用模板事件ID').toBeDefined();
  const dialog = page.getByRole('dialog', { name: '确认转发给阿圆' });
  const note = dialog.getByLabel('给阿圆的附言（可选）', { exact: true });
  const confirm = dialog.locator('button[data-confirm-forward]');
  async function expectPreview() {
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveJSProperty('tagName', 'DIALOG');
    await expect(dialog).toHaveAttribute('open', '');
    await expect(dialog.locator('.forward-preview p')).toHaveText(original.text);
    await expect(dialog.locator('.forward-preview p *')).toHaveCount(0);
    await expect(dialog.locator('.forward-preview')).toContainText(original.actorName);
    await expect(dialog.locator('.forward-preview')).toContainText(original.channel === 'soda' ? '汽水窗口' : '退堂鼓窗口');
    await expect(dialog).toContainText(/转发给阿圆\s*·\s*私聊/);
    await expect(dialog).toContainText(/只.*这一条.*历史.*附言/);
    await expect(dialog).toContainText(/不(?:含|包含|会转发).*其他窗.*未发送草稿/);
    await expect(dialog.getByRole('combobox')).toHaveCount(0);
    await expect(note).toHaveJSProperty('tagName', 'TEXTAREA');
    await expect(note).toHaveAttribute('maxlength', '80');
    await expect(note).toHaveValue('');
    await expect(confirm).toHaveText('确认转发给阿圆');
    await expect(confirm).toBeEnabled();
    expect((await readSave()).saved).toBe(opening.saved);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }

  const cancelledNote = '这段附言取消，不要发送。';
  await page.locator('[data-action="ask_friend"]').click();
  await expectPreview();
  await note.fill(cancelledNote);
  expect((await readSave()).saved).toBe(opening.saved);
  await dialog.getByRole('button', { name: '取消转发', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await readSave()).saved).toBe(opening.saved);

  const escapedNote = '这段附言按Escape放弃。';
  await page.locator('.choice-wrap').filter({ has: page.locator('[data-action="ask_friend"]') }).locator('.say-button').click();
  await expectPreview();
  await note.fill(escapedNote);
  expect((await readSave()).saved).toBe(opening.saved);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect((await readSave()).saved).toBe(opening.saved);

  await activate('[data-action="ask_friend"]');
  await expectPreview();
  const sentNote = '  阿圆，只帮我看看这一条，不用替我回复。  ';
  await note.fill(sentNote);
  expect((await readSave()).saved).toBe(opening.saved);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.screenshot({ path: process.env.CAPTURE_EVIDENCE ? 'docs/evidence/romance-forward.png' : testInfo.outputPath('romance-forward.png') });
  await activate('button[data-confirm-forward]');
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-action="compare_thursday"]')).toBeEnabled();
  const afterForward = await readSave();
  expect(afterForward.inputs).toHaveLength(1);
  expect(afterForward.inputs[0].actionId).toBe('ask_friend');
  expect(afterForward.inputs[0].params).toEqual({ forwardEventId: original.eventId, target: 'friend', channel: 'friend', text: sentNote.trim() });
  const forwarded = afterForward.state.visibleEvents.filter(event => event.kind === 'message_forwarded');
  expect(forwarded).toHaveLength(1);
  expect(forwarded[0].text).toBe(`转发预览已确认：${original.text}\n附言：${sentNote.trim()}`);
  expect(forwarded[0].causeIds).toContain(original.eventId);
  expect(forwarded[0].audience).toEqual(['player', 'friend']);
  expect(forwarded[0].channel).toBe('friend');
  expect(afterForward.state.presentation.friendReceivedEventId).toBe(forwarded[0].eventId);
  const friendEvents = afterForward.state.visibleEvents.filter(event => event.audience.includes('friend'));
  expect(friendEvents.map(event => event.kind)).toEqual(['message_forwarded', 'dialogue']);
  expect(friendEvents[0]).toEqual(forwarded[0]);
  expect(friendEvents[1].actorId).toBe('friend');
  expect(friendEvents[1].channel).toBe('friend');
  expect(friendEvents[1].audience).toEqual(['player', 'friend']);
  expect(friendEvents[1].causeIds).toEqual([forwarded[0].eventId]);
  await expect(page.locator('.dialogue-line p').filter({ hasText: forwarded[0].text })).toHaveCount(1);

  for (const action of ['compare_thursday', 'disclose_forwarding']) await activate(`[data-action="${action}"]`);
  await expect(page.locator('.scene-title h1')).toHaveText('已读，明天再回');
  await expect(page.locator('.scene-title')).toContainText('汽水说明认出日期，两人暂停见面');
  await expect(page.locator('.ending-change-text')).toHaveText(forwarded[0].text);
  const ended = await readSave();
  expect(ended.state.ending?.id).toBe('romance.tomorrow');
  expect(ended.state.visibleEvents.filter(event => event.audience.includes('friend'))).toEqual(friendEvents);
  const friendText = friendEvents.map(event => event.text).join('\n');
  const windowEvents = ended.state.visibleEvents.filter(event => ['soda', 'coach'].includes(event.channel));
  expect(windowEvents.some(event => event.channel !== original.channel)).toBe(true);
  for (const event of windowEvents) {
    expect(event.audience).not.toContain('friend');
    if (event.eventId !== original.eventId) expect(friendText).not.toContain(event.text);
  }
  for (const draft of [cancelledNote, escapedNote, '见。想吃烤肉。']) expect(friendText).not.toContain(draft);
  expect(ended.state.visibleEvents.filter(event => event.kind === 'message_forwarded')).toEqual(forwarded);
  await page.reload();
  await expect(page.locator('.scene-title h1')).toHaveText('已读，明天再回');
  await expect(page.locator('.ending-change-text')).toHaveText(forwarded[0].text);
  await expect(page.locator('.dialogue-line p').filter({ hasText: forwarded[0].text })).toHaveCount(1);
  expect((await readSave()).saved).toBe(ended.saved);
  await expect(page.getByLabel('开启声音')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('双窗切换不耗回合，草稿可发给明确收件人', async ({ page }) => {
  await page.goto('/#/episode/romance');
  await expect(page.locator('[data-action="open_chats"]')).toBeEnabled();
  await page.getByRole('tab', { name: '退堂鼓' }).click();
  await expect(page.locator('#chat-coach')).toBeVisible();
  await expect(page.locator('[data-action="open_chats"]')).toBeEnabled();
  await page.locator('[data-action="open_chats"]').click();
  await expect(page.locator('[data-action="find_draft"]')).toBeEnabled();
  await page.locator('[data-action="find_draft"]').click();
  await expect(page.locator('[data-action="send_original"]')).toBeEnabled();
  await page.locator('[data-action="send_original"]').click();
  await expect(page.locator('.scene-title h1')).toHaveText('原稿就很好');
});

for (const failure of ['unavailable', 'denied'] as const) {
  test(`分享失败可持续手动复制且不改存档：${failure}`, async ({ page }, testInfo) => {
    await page.addInitScript(failure => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: failure === 'unavailable' ? undefined : { writeText: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); } } });
    }, failure);
    await page.goto('/?tracking=discard#/preview/ended');
    await expect(page.locator('.ending-panel')).toBeVisible();
    const saved = await page.evaluate(() => localStorage.getItem('retake.authored.v1'));
    await page.clock.install();
    await page.getByRole('button', { name: '分享开场' }).click();
    const link = page.getByLabel('手动复制开场链接');
    await expect(link).toBeFocused();
    await expect(link).toHaveValue(`${new URL(page.url()).origin}/#/episode/wedding`);
    expect(await link.evaluate(element => {
      const input = element as HTMLInputElement;
      return input.selectionStart === 0 && input.selectionEnd === input.value.length;
    })).toBe(true);
    await page.clock.runFor(5000);
    await expect(link).toBeVisible();
    await expect(page.locator('.scene-title h1')).toHaveText('婚礼现场返工版');
    expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBe(saved);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('share-fallback.png'), fullPage: true });
    await page.getByRole('button', { name: '这集我来演，返回片单' }).click();
    await expect(page.locator('.poster-card')).toHaveCount(5);
    await expect(link).toHaveCount(0);
  });
}

for (const failure of ['canvas', 'encoding', 'decode'] as const) {
  test(`封面失败保留舞台和持续截图指引：${failure}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    const downloads: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('download', download => downloads.push(download.suggestedFilename()));
    await page.goto('/#/preview/ended');
    await expect(page.locator('.ending-panel')).toBeVisible();
    const saved = await page.evaluate(() => localStorage.getItem('retake.authored.v1'));
    await page.evaluate(failure => {
      if (failure === 'canvas') HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
      if (failure === 'encoding') HTMLCanvasElement.prototype.toBlob = callback => callback(null);
      if (failure === 'decode') HTMLImageElement.prototype.decode = async () => { throw new DOMException('The source image cannot be decoded.', 'EncodingError'); };
    }, failure);
    await page.clock.install();
    const save = page.getByRole('button', { name: '保存这张剧照' });
    await save.click();
    await expect(page.locator('.cover-feedback')).toContainText('可直接截图保存上方舞台和结局');
    await page.clock.runFor(5000);
    await expect(page.locator('.cover-feedback')).toBeVisible();
    await expect(save).toBeEnabled();
    await expect(page.locator('.stage svg[data-scene-art]')).toBeVisible();
    await expect(page.locator('.scene-title h1')).toHaveText('婚礼现场返工版');
    expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBe(saved);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('cover-fallback.png'), fullPage: true });
    expect(downloads).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const outcome of ['success', 'failure'] as const) {
  test(`分享${outcome}迟到不覆盖新页面`, async ({ page }) => {
    await page.addInitScript(outcome => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise<void>((resolve, reject) => {
        window.addEventListener('settle-clipboard', () => outcome === 'success' ? resolve() : reject(new DOMException('Permission denied', 'NotAllowedError')), { once: true });
      }) } });
    }, outcome);
    await page.goto('/#/preview/ended');
    await expect(page.locator('.ending-panel')).toBeVisible();
    await page.getByRole('button', { name: '分享开场' }).click();
    await page.getByRole('button', { name: '这集我来演，返回片单' }).click();
    await expect(page.locator('.poster-card')).toHaveCount(5);
    await page.evaluate(async () => {
      window.dispatchEvent(new Event('settle-clipboard'));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await expect(page.locator('.toast')).toHaveCount(0);
    await expect(page.getByLabel('手动复制开场链接')).toHaveCount(0);
  });
}

test('仅键盘与减少动画也能完成扣1，保存结局封面成功', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/episode/reply');
  for (const action of ['quote_game', 'inspect_frame', 'reply_game']) {
    const button = page.locator(`[data-action="${action}"]`);
    await expect(button).toBeEnabled();
    await button.focus();
    await page.keyboard.press('Enter');
    if (/^(quote_|reply_)/.test(action)) {
      await expect(page.getByRole('dialog', { name: '确认引用这条消息' })).toBeVisible();
      const confirm = page.locator('button[data-confirm-quote]');
      await expect(confirm).toBeEnabled();
      await confirm.focus();
      await page.keyboard.press('Enter');
    }
  }
  await expect(page.locator('.scene-title h1')).toHaveText('这人打球有点直');
  await page.getByRole('button', { name: '横过来挡拆' }).focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.court-action')).toContainText('挡拆成功');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存这张剧照' }).click();
  const image = await download; expect(image.suggestedFilename()).toBe('这集我来演-reply.screen.png');
  expect(await image.failure()).toBeNull();
  if (process.env.CAPTURE_EVIDENCE) await image.saveAs('docs/evidence/reply-02-cover.png');
});

test('固定A/B交接状态可直接打开，不修改本机存档', async ({ page }) => {
  for (const state of ['ready', 'pending', 'consent', 'ended', 'rewind']) {
    await page.goto(`/#/preview/${state}`);
    await expect(page.locator('.play-page')).toBeVisible();
    await expect(page.locator('.play-topline')).toContainText('固定交接预览');
    if (process.env.CAPTURE_EVIDENCE) await page.screenshot({ path: `docs/evidence/preview-${state}.png`, fullPage: true });
  }
  expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBeNull();
});

test('等待刷新保持同一请求，继续等与预写完成不会重复落拍', async ({ page }) => {
  await page.goto('/#/episode/wedding');
  await expect(page.locator('[data-action="preview_tail"]')).toBeEnabled();
  await page.locator('[data-action="preview_tail"]').click();
  await expect(page.locator('.pending-panel')).toContainText('拖到片尾预览');
  const requestId = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('retake.authored.v1')!);
    const pending = Object.values(data.pending)[0] as { due: number; startedAt: number; input: { requestId: string } };
    pending.due = Date.now() + 60000;
    pending.startedAt = Date.now() - 9000;
    localStorage.setItem('retake.authored.v1', JSON.stringify(data));
    return pending.input.requestId;
  });
  await page.reload();
  await expect(page.locator('.pending-panel')).toContainText('拖到片尾预览');
  expect(await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('retake.authored.v1')!);
    return (Object.values(data.pending)[0] as { input: { requestId: string } }).input.requestId;
  })).toBe(requestId);
  await expect(page.getByRole('button', { name: '倒带', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '继续等', exact: true }).click();
  await expect(page.locator('.pending-panel')).toBeVisible();
  await page.getByRole('button', { name: '用编剧预写接下去' }).click();
  await expect(page.locator('[data-action="private_preview"]')).toBeEnabled();
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('retake.authored.v1')!).pending))).toEqual([]);
  await page.reload();
  await expect(page.locator('[data-action="private_preview"]')).toBeEnabled();
  await expect(page.locator('.dialogue p').filter({ hasText: '小窗最后一页有一行空白' })).toHaveCount(1);
});

test('只有可说话的动作提供自由台词，扣1正文不可改写', async ({ page }) => {
  await page.goto('/#/episode/reply');
  await expect(page.locator('[data-action="quote_game"]')).toBeEnabled();
  await expect(page.getByRole('button', { name: '换一句自己的话' })).toHaveCount(0);
  for (const action of ['quote_game', 'inspect_frame']) {
    await page.locator(`[data-action="${action}"]`).click();
    if (/^(quote_|reply_)/.test(action)) {
      await expect(page.getByRole('dialog', { name: '确认引用这条消息' })).toBeVisible();
      const confirm = page.locator('button[data-confirm-quote]');
      await expect(confirm).toBeEnabled();
      await confirm.click();
    }
    await expect(page.locator('.action-panel')).toBeVisible();
  }
  await expect(page.getByRole('button', { name: '换一句自己的话' })).toHaveCount(0);
  await page.locator('[data-action="reply_game"]').click();
  await expect(page.getByRole('dialog', { name: '确认引用这条消息' })).toBeVisible();
  const confirm = page.locator('button[data-confirm-quote]');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.locator('.scene-title h1')).toHaveText('这人打球有点直');
});

test('未获得的反转不预显，原片加载后各帧是真实不同图', async ({ page }) => {
  await page.goto('/#/episode/office');
  await expect(page.locator('[data-action="read_roster"]')).toBeEnabled();
  await expect(page.locator('.stage')).not.toContainText('人工转接');
  await expect(page.locator('.stage svg[data-scene-art]')).not.toContainText('老组长');
  await page.goto('/#/episode/romance');
  await expect(page.locator('[data-action="open_chats"]')).toBeEnabled();
  await expect(page.locator('.stage')).not.toContainText('上周四');
  await expect(page.locator('.stage')).not.toContainText('我喜欢他');
  await page.goto('/#/episode/reply');
  await expect(page.locator('[data-action="quote_clip"]')).toBeEnabled();
  await expect(page.locator('.frame-controls')).toHaveCount(0);
  await page.locator('[data-action="quote_clip"]').click();
  await expect(page.getByRole('dialog', { name: '确认引用这条消息' })).toBeVisible();
  const confirm = page.locator('button[data-confirm-quote]');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.locator('[data-action="inspect_bucket"]')).toBeEnabled();
  const first = await page.locator('.clip-player svg').innerHTML();
  await page.getByRole('button', { name: '桶左移', exact: true }).click();
  const second = await page.locator('.clip-player svg').innerHTML();
  expect(second).not.toEqual(first);
  await expect(page.locator('[data-prop="bucket-moved"]')).toHaveAttribute('transform', 'translate(-55 0)');
  await page.getByRole('button', { name: '纸背原题', exact: true }).click();
  await expect(page.locator('[data-prop="math-paper"]')).toBeVisible();
  await expect(page.locator('[data-action="inspect_bucket"]')).toBeEnabled();
});

test('首页多尺寸无横滚，主题变量在实际页面生效', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.poster-card')).toHaveCount(5);
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 780 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.CAPTURE_EVIDENCE) {
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await page.screenshot({ path: `docs/evidence/catalog-${width}.png`, fullPage: true });
    }
  }
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--site-accent', '#123456');
    document.documentElement.style.setProperty('--site-font', 'Georgia, serif');
  });
  expect(await page.locator('.brand-icon').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(18, 52, 86)');
  expect(await page.locator('body').evaluate(el => getComputedStyle(el).fontFamily)).toContain('Georgia');
});

test('未知剧目和损坏地址明确返回片单，不陷入加载', async ({ page }) => {
  await page.goto('/#/episode/unknown');
  await expect(page.getByRole('alert')).toContainText('片单里没有');
  await page.getByRole('alert').getByRole('button', { name: '回片单' }).click();
  await expect(page.locator('.poster-card')).toHaveCount(5);
});
