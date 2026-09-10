import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

import {createApp} from './server.mjs';
import {validateAnimation, validateRecipe} from './public/contracts.mjs';
import {
  exportGLB,
  fromRecipe,
  importGLB,
  poses,
  quat,
  slerp
} from './public/engine.mjs';

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

test('owl preserves nine animation clips on export/reimport', async () => {
  const bytes = await readFile(
    new URL('./public/assets/lilac-animated.glb', import.meta.url)
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
    }
  );
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
