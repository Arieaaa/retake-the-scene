import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), {
    name: 'exclude-private-site-modules',
    generateBundle(_options, bundle) {
      if (process.env.VITE_GAME_MODE !== 'site') return;
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk' && Object.keys(output.modules).some(id => /\/(server|fixtures|content)\//.test(id))) {
          this.error('Site JavaScript contains private rules, fixtures or episode packages.');
        }
      }
    },
  }],
  server: { host: '127.0.0.1', port: 5173 },
  build: { outDir: 'dist' },
});
