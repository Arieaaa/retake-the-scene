import { createDatabaseClient } from './_qoder/backend.mjs';
import { createSiteHandler } from './game.mjs';

Deno.serve(async request => {
  try {
    const origin = Deno.env.get('RETAKE_SITE_ORIGIN');
    if (!origin) return Response.json({ code: 'SERVICE_NOT_CONFIGURED', message: '站点尚未配置演出服务。', retryable: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    return await createSiteHandler(createDatabaseClient(), origin)(request);
  } catch {
    return Response.json({ code: 'SERVICE_UNAVAILABLE', message: '演出服务暂时不可用，请沿用原请求重试。', retryable: true }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
});
