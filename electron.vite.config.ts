import { createReadStream, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import type { Connect, Plugin } from 'vite';

/** Where CLI runs drop screenshots. */
const CLI_CAPTURE_DIR = resolve(__dirname, 'captures');
/** Where the Electron app drops them, matching app.setPath('userData') in main. */
const APP_CAPTURE_DIR = join(homedir(), 'Library', 'Application Support', 'astral-express-pilot', 'Screenshots');
const CAPTURE_DIRS = [CLI_CAPTURE_DIR, APP_CAPTURE_DIR];

/**
 * Lets the dev renderer preview screenshots under /capture/. In production the window loads
 * from file:// and the main process's capture:// protocol handler serves the same paths.
 */
function capturePreview(): Plugin {
  return {
    name: 'capture-preview',
    configureServer(server) {
      server.middlewares.use((req: Connect.IncomingMessage, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]!);
        if (!path.startsWith('/capture/')) return next();
        const name = path.slice('/capture/'.length);
        const dir = CAPTURE_DIRS.find((d) => existsSync(join(d, name)));
        if (!dir) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('Content-Type', 'image/png');
        createReadStream(join(dir, name)).pipe(res);
      });
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('app/main/index.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve('app/preload/index.ts'),
        // A sandboxed preload cannot be ESM, so this one entry stays CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve('app/renderer'),
    plugins: [react(), capturePreview()],
    server: { port: 65173 },
    build: { rollupOptions: { input: resolve('app/renderer/index.html') } },
  },
});
