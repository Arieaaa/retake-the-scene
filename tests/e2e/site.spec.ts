import { expect, test } from '@playwright/test';
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
