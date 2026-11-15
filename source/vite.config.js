import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { target: 'es2020', assetsDir: 'js', assetsInlineLimit: 0, chunkSizeWarningLimit: 1500 },
  server: { host: true, allowedHosts: true },
  preview: { host: true, allowedHosts: true, port: 4188, strictPort: true },
});
