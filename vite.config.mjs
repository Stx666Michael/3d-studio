import react from '@vitejs/plugin-react';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = path.join(PROJECT_ROOT, 'public');

export default defineConfig({
  root: PUBLIC_ROOT,
  publicDir: false,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false
      }
    }
  },
  build: {
    outDir: path.join(PROJECT_ROOT, 'dist'),
    emptyOutDir: true
  }
});
