import { expect, test } from '@playwright/test';

test('候选站点只读门禁：公开页面、在线模式与真实目录接口', async ({ page, request, baseURL }) => {
  await page.goto(baseURL!);
  await expect(page.locator('.mode-pill'), '目标必须是在线模式，不能以作者预演冒充真实站点').toHaveText('在线演出');
  await expect(page.locator('.poster-card')).toHaveCount(5);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const response = await request.get('/functions/v1/app/api/episodes');
  expect(response.status(), '真实目录接口应匿名返回200').toBe(200);
  expect(response.headers()['content-type']).toContain('application/json');
  const catalog = await response.json() as { id: string }[];
  expect(catalog.map(episode => episode.id).sort()).toEqual(['hiss', 'office', 'reply', 'romance', 'wedding']);
  expect(await page.evaluate(() => localStorage.getItem('retake.authored.v1'))).toBeNull();
});
