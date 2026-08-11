import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

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
    plugins: [react()],
    server: { port: 65173 },
    build: { rollupOptions: { input: resolve('app/renderer/index.html') } },
  },
});
