import {fileURLToPath} from 'node:url';
import {createServer as createViteServer} from 'vite';

import {createApp} from './server.mjs';

const API_PORT = 3001;
const viteConfig = fileURLToPath(new URL('./vite.config.mjs', import.meta.url));
const apiServer = createApp();

await new Promise((resolve, reject) => {
  apiServer.once('error', reject);
  apiServer.listen(API_PORT, '127.0.0.1', resolve);
});

const viteServer = await createViteServer({
  configFile: viteConfig,
  server: {
    hmr: true
  }
});
await viteServer.listen();

console.log(
  'Lilac Studio development server: http://127.0.0.1:3000\n' +
    'Frontend changes use Vite HMR; API requests use the local backend on port 3001.'
);

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  await viteServer.close();
  await new Promise(resolve => apiServer.close(resolve));
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await shutdown();
    process.exit(0);
  });
}
