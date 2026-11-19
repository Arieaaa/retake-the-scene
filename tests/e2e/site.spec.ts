import { expect, test, type Route } from '@playwright/test';
import { episodes } from '../../content/episodes';
import { previewViews } from '../../fixtures/public/views';
import type { PlayerView, TurnInput } from '../../shared/contracts';

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
  await page.getByRole('button', { name: '这集我来演，返回片单' }).click();
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

test('站点模拟：202刷新恢复和预写竞争只提交原请求', async ({ page }) => {
  const ready = structuredClone(previewViews.ready);
  const completed: PlayerView = { ...structuredClone(previewViews.rewind), runId: ready.runId, branchId: ready.branchId, revision: 1, branches: ready.branches };
  let current = ready;
  let turn: TurnInput | null = null;
  const submissions: string[] = [];
  const fallbacks: string[] = [];
  await page.route(api, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/episodes')) return route.fulfill({ json: episodes });
    if (path.endsWith('/api/runs')) return route.fulfill({ json: ready });
    if (path.endsWith('/turns')) {
      turn = request.postDataJSON() as TurnInput;
      submissions.push(turn.requestId);
      current = { ...ready, status: 'pending', choices: [], activeRequest: { requestId: turn.requestId, actionId: turn.actionId, label: '拖到片尾预览', startedAt: Date.now() - 9000, allowFallback: true } };
      return route.fulfill({ status: 202, json: { requestId: turn.requestId, status: 'pending', pollUrl: `${path}/${turn.requestId}` } });
    }
    if (path.endsWith('/fallback')) {
      fallbacks.push(path.split('/').at(-2)!);
      current = completed;
      return route.fulfill({ json: completed });
    }
    if (path.includes('/turns/')) return route.fulfill({ status: current.status === 'pending' ? 202 : 200, json: current.status === 'pending' ? { requestId: turn!.requestId, status: 'pending', pollUrl: path } : completed });
    return route.fulfill({ json: current });
  });
  await page.goto(`${origin}/#/episode/wedding`);
  await expect(page.locator('[data-action="preview_tail"]')).toBeEnabled();
  await page.locator('[data-action="preview_tail"]').click();
  await expect(page.locator('.pending-panel')).toContainText('拖到片尾预览');
  await page.reload();
  await expect(page.locator('.pending-panel')).toContainText('拖到片尾预览');
  await page.getByRole('button', { name: '用编剧预写接下去' }).click();
  await expect(page.locator('[data-action="private_preview"]')).toBeEnabled();
  await page.reload();
  await expect(page.locator('[data-action="private_preview"]')).toBeEnabled();
  expect(submissions).toHaveLength(1);
  expect(fallbacks).toEqual(submissions);
  expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBeNull();
});

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
  await expect(page.locator('[data-action="hold_photos"]')).toBeDisabled();
  await page.getByRole('button', { name: '重试原操作' }).click();
  await expect(page.locator('[data-action="private_preview"]')).toBeEnabled();
  expect(inputs).toHaveLength(2);
  expect(inputs[1]).toEqual(inputs[0]);
});
