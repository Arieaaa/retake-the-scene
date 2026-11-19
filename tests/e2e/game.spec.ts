import { expect, test } from '@playwright/test';
import acceptance from '../../五剧十五结局-验收样例.json' with { type: 'json' };

for (const scenario of acceptance.cases) {
  test(`作者预演 ${scenario.caseId}: ${scenario.expected.title}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('.poster-card')).toHaveCount(5);
    await page.locator(`[data-episode="${scenario.episodeId}"]`).click();
    for (const turn of scenario.turns) {
      const choice = page.locator(`[data-action="${turn.actionId}"]`);
      await expect(choice).toBeEnabled();
      await choice.click();
    }
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
    for (const turn of scenario.turns) await activate(`[data-action="${turn.actionId}"]`);
    await expect(page.locator('.scene-title h1')).toHaveText(scenario.expected.title);
    await expect(page.locator('.scene-title')).toContainText(scenario.expected.visibleResult);
    await expect(page.getByLabel('开启声音')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
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

test('仅键盘与减少动画也能完成扣1，保存结局封面成功', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/#/episode/reply');
  for (const action of ['quote_game', 'inspect_frame', 'reply_game']) { const button = page.locator(`[data-action="${action}"]`); await expect(button).toBeEnabled(); await button.focus(); await page.keyboard.press('Enter'); }
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
    await expect(page.locator('.action-panel')).toBeVisible();
  }
  await expect(page.getByRole('button', { name: '换一句自己的话' })).toHaveCount(0);
  await page.locator('[data-action="reply_game"]').click();
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
    if (process.env.CAPTURE_EVIDENCE) await page.screenshot({ path: `docs/evidence/catalog-${width}.png`, fullPage: true });
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
