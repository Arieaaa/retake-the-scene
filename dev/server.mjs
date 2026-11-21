import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.RETAKE_PORT ?? 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('RETAKE_PORT must be 1024–65535.');
const origin = `http://127.0.0.1:${port}`;
const database = process.env.RETAKE_DB_PATH === ':memory:' ? ':memory:'
  : resolve(root, process.env.RETAKE_DB_PATH ?? '.server-data/game.sqlite');
if (database !== ':memory:') mkdirSync(dirname(database), { recursive: true });
let repository;
const server = await createServer({
  root,
  define: { 'import.meta.env.VITE_GAME_MODE': JSON.stringify('site') },
  server: { host: '127.0.0.1', port, strictPort: true },
  plugins: [{
    name: 'retake-local-api',
    configureServer(vite) {
      vite.middlewares.use('/functions/v1/app', async (incoming, outgoing) => {
        try {
          const { createHandler } = await vite.ssrLoadModule('/server/api/handler.ts');
          const request = new Request(`${origin}${incoming.originalUrl}`, {
            method: incoming.method,
            headers: incoming.headers,
            ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}),
          });
          const result = await createHandler({ repository, origin, allowInsecureLocalhost: true })(request);
          outgoing.writeHead(result.status, Object.fromEntries(result.headers));
          outgoing.end(Buffer.from(await result.arrayBuffer()));
        } catch {
          outgoing.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          outgoing.end(JSON.stringify({ code: 'SERVICE_UNAVAILABLE', message: '本地服务暂不可用，请沿用原请求重试。', retryable: true }));
        }
      });
    },
  }],
});
const { SqliteRepository } = await server.ssrLoadModule('/server/store/sqlite.ts');
repository = new SqliteRepository(database);
await server.listen();
console.log(`B backend preview: ${origin} (PID ${process.pid}; SQLite; authored dialogue, no live NPC)`);
async function close() { await server.close(); repository.close(); process.exit(0); }
process.on('SIGINT', close);
process.on('SIGTERM', close);
