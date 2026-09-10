import path from 'node:path';
import {fileURLToPath} from 'node:url';

process.env.STUDIO_STATIC_ROOT = path.resolve(
  fileURLToPath(new URL('./dist/', import.meta.url))
);

const {createApp} = await import('./server.mjs');
const port = Number(process.env.PORT || 3000);

createApp().listen(port, '127.0.0.1', () => {
  console.log(
    `3D Studio: http://127.0.0.1:${port}\n` +
      'Production frontend bundle served locally. Keys stay in server memory. Ctrl+C to stop.'
  );
});
