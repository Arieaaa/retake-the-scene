import { copyFileSync, readdirSync, readFileSync } from 'node:fs';
import { build } from 'vite';

await build({
  configFile: false,
  publicDir: false,
  build: {
    outDir: 'dist-function',
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    lib: { entry: 'server/function.ts', formats: ['es'], fileName: () => 'game.mjs' },
    rollupOptions: { onwarn(warning, warn) { if (warning.code === 'UNRESOLVED_IMPORT') throw new Error(warning.message); warn(warning); } },
  },
});
copyFileSync('functions/index.ts', 'dist-function/index.ts');
const files = readdirSync('dist-function').sort();
if (files.join(',') !== 'game.mjs,index.ts') throw new Error('Unexpected Function bundle contents.');
const output = readFileSync('dist-function/game.mjs', 'utf8');
if (/node:sqlite|localStorage|retake\.authored\.v1|fixtures\/public/.test(output)) throw new Error('Function contains local-only code.');
console.log('Function package: dist-function/ (SDK injected by Sites; schema applied separately).');
