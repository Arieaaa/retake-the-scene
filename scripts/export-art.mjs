import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { writeFile, unlink } from 'node:fs/promises';

const output = new URL('./.generated-art.mjs', import.meta.url);
await build({ entryPoints: ['src/stages/Art.tsx'], outfile: output.pathname, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', external: ['react', 'react/jsx-runtime'] });
try {
  const { default: Art } = await import(output.href);
  for (const episode of ['wedding', 'office', 'romance', 'hiss', 'reply']) {
    const svg = renderToStaticMarkup(createElement(Art, { episode })).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    await writeFile(`public/art/${episode}.svg`, svg);
  }
  console.log('Exported five original SVG posters.');
} finally { await unlink(output); }
