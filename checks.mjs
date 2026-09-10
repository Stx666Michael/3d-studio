import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

import {createApp} from './server.mjs';
import {
  LIMITS,
  validateAnimation,
  validateRecipe
} from './public/contracts.mjs';
import {
  exportGLB,
  fromRecipe,
  importGLB,
  poses,
  quat,
  slerp
} from './public/engine.mjs';
import {
  MAX_PROJECT_GLB_LENGTH,
  parseProject,
  serializeProject
} from './public/project.mjs';

const recipe = {
  name: 'Robot',
  parts: [
    {
      id: 'body',
      name: 'Body',
      shape: 'sphere',
      position: [0, 1, 0],
      rotation: [0, 0, 0],
      scale: [0.8, 1, 0.6],
      pivot: [0, 1, 0],
      color: '#9466bb'
    }
  ]
};

test('validates bounded recipes and rejects duplicates', () => {
  assert.equal(validateRecipe(recipe).parts.length, 1);
  assert.throws(() =>
    validateRecipe({...recipe, parts: [...recipe.parts, ...recipe.parts]})
  );
  assert.throws(() =>
    validateRecipe({
      ...recipe,
      parts: [{...recipe.parts[0], scale: [NaN, 1, 1]}]
    })
  );
});

test('all primitive types round-trip through GLB', () => {
  for (const shape of ['sphere', 'box', 'cone', 'cylinder']) {
    const document = fromRecipe({
      ...recipe,
      parts: [{...recipe.parts[0], shape}]
    });
    const imported = importGLB(exportGLB(document));

    assert.equal(imported.meshes.length, 1);
    assert(imported.meshes[0].positions.every(Number.isFinite));
  }
});

test('rejects GLB imports above the 50 MB limit', () => {
  assert.equal(LIMITS.upload, 50 * 1024 * 1024);
  assert.equal(LIMITS.vertices, 1_000_000);
  assert.equal(LIMITS.triangles, 1_000_000);
  assert.throws(
    () => importGLB({byteLength: LIMITS.upload + 1}),
    /Maximum file size is 50 MB/
  );
});

test('owl preserves nine animation clips on export/reimport', async () => {
  const bytes = await readFile(
    new URL('./public/assets/starter-owl.glb', import.meta.url)
  );
  const original = importGLB(Uint8Array.from(bytes).buffer);
  const imported = importGLB(exportGLB(original));

  assert.equal(original.clips.length, 9);
  assert.equal(imported.clips.length, 9);
  assert.equal(original.nodes.length, imported.nodes.length);

  for (let index = 0; index < 9; index++) {
    assert.equal(
      original.clips[index].tracks.length,
      imported.clips[index].tracks.length
    );
  }
});

test('GLB export can select one animation or the base pose', () => {
  const document = fromRecipe(recipe);
  document.clips = [
    {
      id: 'wave',
      name: 'Wave',
      duration: 1,
      loop: true,
      tracks: [
        {
          nodeId: 'body',
          property: 'translation',
          interpolation: 'LINEAR',
          keys: [
            {time: 0, value: [0, 1, 0]},
            {time: 1, value: [0, 2, 0]}
          ]
        }
      ]
    },
    {
      id: 'turn',
      name: 'Turn',
      duration: 1,
      loop: false,
      tracks: [
        {
          nodeId: 'body',
          property: 'rotation',
          interpolation: 'LINEAR',
          keys: [
            {time: 0, value: [0, 0, 0, 1]},
            {time: 1, value: quat([0, 90, 0])}
          ]
        }
      ]
    }
  ];

  assert.deepEqual(
    importGLB(exportGLB(document, {animationId: 'wave'})).clips.map(
      clip => clip.name
    ),
    ['Wave']
  );
  assert.deepEqual(
    importGLB(exportGLB(document, {animationId: ''})).clips,
    []
  );
  assert.equal(
    importGLB(exportGLB(document, {animationId: '__all__'})).clips.length,
    2
  );

  const empty = importGLB(
    exportGLB(
      {name: 'Empty', nodes: [], meshes: [], clips: []},
      {animationId: ''}
    )
  );
  assert.equal(empty.nodes.length, 0);
  assert.equal(empty.clips.length, 0);
});

test('current project format round-trips multiple scenes', () => {
  assert.equal(LIMITS.scenes, 32);
  assert.equal(
    MAX_PROJECT_GLB_LENGTH,
    Math.ceil(LIMITS.upload / 3) * 4
  );
  const first = fromRecipe(recipe);
  const second = fromRecipe({...recipe, name: 'Second'});
  const projectText = serializeProject(
    [
      {id: 'scene-first', document: first},
      {id: 'scene-second', document: second}
    ],
    'scene-second'
  );
  const restored = parseProject(projectText);

  const saved = JSON.parse(projectText);
  assert.equal(saved.format, '3d-studio-project');
  assert.equal(saved.version, 1);
  assert.equal(restored.scenes.length, 2);
  assert.equal(restored.activeSceneId, 'scene-second');
  assert.equal(restored.scenes[0].document.nodes.length, first.nodes.length);
  assert.equal(restored.scenes[1].document.name, 'Second');
  assert.throws(
    () => parseProject(JSON.stringify({...saved, format: 'lilac-project'})),
    /supported 3D Studio project/
  );
});

test('keyframe sampling does not mutate rest pose', () => {
  const document = fromRecipe(recipe);
  const clip = {
    tracks: [
      {
        nodeId: 'body',
        property: 'translation',
        interpolation: 'LINEAR',
        keys: [
          {time: 0, value: [0, 1, 0]},
          {time: 2, value: [0, 3, 0]}
        ]
      }
    ]
  };

  assert.equal(poses(document, clip, 1).get('body').translation[1], 2);
  assert.equal(document.nodes.find(node => node.id === 'body').translation[1], 1);
});

test('quaternion interpolation remains normalized', () => {
  const halfway = slerp([0, 0, 0, 1], quat([0, 0, 90]), 0.5);
  assert(Math.abs(Math.hypot(...halfway) - 1) < 1e-6);
});

test('animation schema rejects unknown targets and bad quaternions', () => {
  const animation = {
    name: 'Wave',
    duration: 2,
    loop: true,
    tracks: [
      {
        nodeId: 'body',
        property: 'rotation',
        interpolation: 'LINEAR',
        keys: [
          {time: 0, value: [0, 0, 0, 1]},
          {time: 2, value: quat([0, 0, 30])}
        ]
      }
    ]
  };
  const manifest = {nodes: [{id: 'body'}]};

  assert(validateAnimation(animation, manifest));
  assert.throws(() => validateAnimation(animation, {nodes: []}));
  assert.throws(() =>
    validateAnimation(
      {
        ...animation,
        tracks: [
          {
            ...animation.tracks[0],
            keys: [{time: 0, value: [0, 0, 0, 0]}]
          }
        ]
      },
      manifest
    )
  );
});

async function runServer(fetchImpl, key, callback) {
  const server = createApp({fetchImpl, environmentKey: key});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${url}/api/session`);
    const session = await response.json();
    const cookie = response.headers.get('set-cookie').split(';')[0];

    await callback(url, session, {
      'Content-Type': 'application/json',
      Origin: url,
      Cookie: cookie,
      'x-csrf-token': session.csrf
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('server never exposes keys and protects mutations with CSRF', async () => {
  await runServer(
    () => {
      throw Error('No provider call expected');
    },
    'fake-secret-for-test',
    async (url, session, headers) => {
      assert(session.configured);
      assert(!JSON.stringify(session).includes('fake-secret'));
      assert.equal(
        (
          await fetch(`${url}/api/connection`, {
            method: 'DELETE',
            headers: {Cookie: headers.Cookie}
          })
        ).status,
        403
      );
      assert.equal((await fetch(`${url}/engine.mjs`)).status, 200);
      const threeResponse = await fetch(`${url}/vendor/three.module.js`);
      assert.equal(threeResponse.status, 200);
      assert.match(
        threeResponse.headers.get('content-type') || '',
        /javascript/
      );
    }
  );
});

test('retired session cookies are rejected', async () => {
  const server = createApp({
    fetchImpl: () => {
      throw Error('No provider call expected');
    },
    environmentKey: ''
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${url}/api/connection`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: url,
        Cookie: 'lilac_session=retired-session',
        'x-csrf-token': 'retired-token'
      },
      body: JSON.stringify({
        key: 'fake-secret-for-test',
        model: 'gemini-3.8-flash'
      })
    });

    assert.equal(response.status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('Gemini adapter sends a compatible model schema and validates response', async () => {
  await runServer(
    async (url, options) => {
      assert(url.startsWith('https://generativelanguage.googleapis.com/'));
      assert.equal(options.headers['x-goog-api-key'], 'fake-secret-for-test');

      const schema = JSON.parse(options.body).generationConfig.responseJsonSchema;
      assert(schema);
      assert.equal(schema.properties.parts.minItems, undefined);
      assert.equal(schema.properties.parts.maxItems, undefined);
      assert.equal(
        schema.properties.parts.items.properties.position.minItems,
        3
      );

      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: {parts: [{text: JSON.stringify(recipe)}]}
            }
          ]
        })
      );
    },
    'fake-secret-for-test',
    async (url, session, headers) => {
      const response = await fetch(`${url}/api/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({kind: 'model', prompt: 'A cute robot'})
      });

      assert.equal(response.status, 200);
      assert.equal((await response.json()).result.name, 'Robot');
    }
  );
});

test('missing keys and malformed Gemini output fail safely', async () => {
  await runServer(
    () => {
      throw Error('No provider call expected');
    },
    '',
    async (url, session, headers) => {
      const response = await fetch(`${url}/api/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({kind: 'model', prompt: 'A robot'})
      });

      assert.equal(response.status, 401);
    }
  );

  await runServer(
    async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: {parts: [{text: '{"name":"bad","parts":[]}'}]}
            }
          ]
        })
      ),
    'fake-secret-for-test',
    async (url, session, headers) => {
      const response = await fetch(`${url}/api/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({kind: 'model', prompt: 'A robot'})
      });

      assert.equal(response.status, 422);
    }
  );
});

test('configures Vite for automatic frontend rebuilds', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('./package.json', import.meta.url))
  );

  assert.equal(
    packageJson.scripts.dev,
    'node --env-file-if-exists=.env dev.mjs'
  );
  assert.equal(packageJson.scripts.build, 'vite build');
  assert(packageJson.dependencies?.react);
  assert(packageJson.dependencies?.['react-dom']);
  assert(packageJson.devDependencies?.vite);
  assert(packageJson.devDependencies?.['@vitejs/plugin-react']);

  const indexHtml = await readFile(
    new URL('./public/index.html', import.meta.url),
    'utf8'
  );
  assert.match(indexHtml, /id="root"/);
  assert.match(indexHtml, /src="\/app\.jsx"/);
  const editorShell = await readFile(
    new URL('./public/editor-shell.html', import.meta.url),
    'utf8'
  );
  assert.match(editorShell, /id="generationState"/);
  assert.match(editorShell, /accept="\.glb,\.3ds"/);

  const editorController = await readFile(
    new URL('./public/editor-controller.mjs', import.meta.url),
    'utf8'
  );
  assert.match(editorController, /my_project\.3ds/);
  assert.match(editorController, /file\.name\.endsWith\('\.3ds'\)/);

  const generationStyles = await readFile(
    new URL('./public/generation.css', import.meta.url),
    'utf8'
  );
  assert.match(generationStyles, /@keyframes generation-spin/);

  const {default: viteConfig} = await import('./vite.config.mjs');
  assert.equal(
    viteConfig.root,
    new URL('./public/', import.meta.url).pathname.replace(/\/$/, '')
  );
  assert.equal(
    viteConfig.server.proxy['/api'].target,
    'http://127.0.0.1:3001'
  );
});
