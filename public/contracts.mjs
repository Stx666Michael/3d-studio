export const LIMITS = {
  nodes: 160,
  parts: 64,
  tracks: 128,
  keys: 2048,
  vertices: 1_000_000,
  triangles: 1_000_000,
  upload: 50 * 1024 * 1024
};

const fail = message => {
  throw new Error(message);
};

export const finite = (value, min = -10000, max = 10000) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;

export function vector(value, length, min = -100, max = 100) {
  if (
    !Array.isArray(value) ||
    value.length !== length ||
    !value.every(item => finite(item, min, max))
  ) {
    fail(`Expected ${length} finite numbers in range ${min}…${max}.`);
  }

  return [...value];
}

const text = (value, max = 120) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail('Invalid or oversized text field.');
  }

  return value.trim();
};

const PART_SHAPES = ['sphere', 'box', 'cylinder', 'cone'];

export function validateRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') {
    fail('Model response must be an object.');
  }

  const name = text(recipe.name);
  if (
    !Array.isArray(recipe.parts) ||
    !recipe.parts.length ||
    recipe.parts.length > LIMITS.parts
  ) {
    fail('A model must contain 1–64 parts.');
  }

  const ids = new Set();
  const parts = recipe.parts.map(part => {
    const id = text(part.id, 60);
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id) || ids.has(id)) {
      fail('Part IDs must be unique simple identifiers.');
    }

    ids.add(id);
    if (!PART_SHAPES.includes(part.shape)) {
      fail('Unsupported primitive.');
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(part.color)) {
      fail('Use a six-digit hex colour.');
    }

    return {
      id,
      name: text(part.name),
      shape: part.shape,
      position: vector(part.position, 3, -10, 10),
      rotation: vector(part.rotation, 3, -360, 360),
      scale: vector(part.scale, 3, 0.01, 10),
      color: part.color,
      pivot: vector(part.pivot, 3, -10, 10)
    };
  });

  return {name, parts};
}

const ANIMATION_PROPERTIES = ['translation', 'rotation', 'scale'];
const INTERPOLATIONS = ['LINEAR', 'STEP'];

export function validateAnimation(animation, manifest) {
  if (!animation || typeof animation !== 'object') {
    fail('Animation response must be an object.');
  }

  const name = text(animation.name);
  if (!finite(animation.duration, 0.1, 30)) {
    fail('Duration must be 0.1–30 seconds.');
  }
  if (
    !Array.isArray(animation.tracks) ||
    !animation.tracks.length ||
    animation.tracks.length > LIMITS.tracks
  ) {
    fail('Expected 1–128 animation tracks.');
  }

  let totalKeys = 0;
  let previousTime = -1;
  const usedTargets = new Set();
  const knownNodes = new Set(manifest.nodes.map(node => node.id));

  const tracks = animation.tracks.map(track => {
    if (!knownNodes.has(track.nodeId)) {
      fail(`Unknown animation target: ${String(track.nodeId).slice(0, 60)}`);
    }
    if (!ANIMATION_PROPERTIES.includes(track.property)) {
      fail('Unsupported animation property.');
    }

    const target = `${track.nodeId}:${track.property}`;
    if (usedTargets.has(target)) {
      fail('Duplicate target/property track.');
    }
    usedTargets.add(target);

    if (!INTERPOLATIONS.includes(track.interpolation)) {
      fail('Use LINEAR or STEP interpolation.');
    }
    if (!Array.isArray(track.keys) || !track.keys.length) {
      fail('Every track needs keyframes.');
    }

    totalKeys += track.keys.length;
    if (totalKeys > LIMITS.keys) {
      fail('Too many keyframes.');
    }

    previousTime = -1;
    const keys = track.keys.map(key => {
      if (
        !finite(key.time, 0, animation.duration) ||
        key.time <= previousTime
      ) {
        fail('Keyframe times must be unique, increasing, and within the clip.');
      }
      previousTime = key.time;

      const value = vector(
        key.value,
        track.property === 'rotation' ? 4 : 3,
        track.property === 'scale' ? 0.001 : -100,
        100
      );

      if (track.property === 'rotation') {
        const length = Math.hypot(...value);
        if (length < 0.9 || length > 1.1) {
          fail('Rotation values must be normalized quaternions.');
        }

        return {
          time: key.time,
          value: value.map(item => item / length)
        };
      }

      return {time: key.time, value};
    });

    return {
      nodeId: track.nodeId,
      property: track.property,
      interpolation: track.interpolation,
      keys
    };
  });

  return {
    id: globalThis.crypto.randomUUID(),
    name,
    duration: animation.duration,
    loop: Boolean(animation.loop),
    tracks
  };
}

const numberSchema = {type: 'number'};
const stringSchema = {type: 'string'};
const vectorSchema = length => ({
  type: 'array',
  items: numberSchema,
  minItems: length,
  maxItems: length
});

const recipePartSchema = {
  type: 'object',
  properties: {
    id: stringSchema,
    name: stringSchema,
    shape: {
      type: 'string',
      enum: PART_SHAPES
    },
    position: vectorSchema(3),
    rotation: vectorSchema(3),
    scale: vectorSchema(3),
    color: stringSchema,
    pivot: vectorSchema(3)
  },
  required: [
    'id',
    'name',
    'shape',
    'position',
    'rotation',
    'scale',
    'color',
    'pivot'
  ],
  additionalProperties: false
};

export const recipeSchema = {
  type: 'object',
  properties: {
    name: stringSchema,
    parts: {
      type: 'array',
      items: recipePartSchema
    }
  },
  required: ['name', 'parts'],
  additionalProperties: false
};

export const animationSchema = {
  type: 'object',
  properties: {
    name: stringSchema,
    duration: numberSchema,
    loop: {type: 'boolean'},
    tracks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nodeId: stringSchema,
          property: {
            type: 'string',
            enum: ANIMATION_PROPERTIES
          },
          interpolation: {
            type: 'string',
            enum: INTERPOLATIONS
          },
          keys: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                time: numberSchema,
                value: {
                  type: 'array',
                  items: numberSchema
                }
              },
              required: ['time', 'value'],
              additionalProperties: false
            }
          }
        },
        required: ['nodeId', 'property', 'interpolation', 'keys'],
        additionalProperties: false
      }
    }
  },
  required: ['name', 'duration', 'loop', 'tracks'],
  additionalProperties: false
};

export function validateManifest(manifest) {
  if (
    !manifest ||
    !Array.isArray(manifest.nodes) ||
    manifest.nodes.length > LIMITS.nodes
  ) {
    fail('Invalid scene manifest.');
  }

  return {
    nodes: manifest.nodes.map(node => ({
      id: text(node.id, 80),
      name: text(node.name, 120),
      translation: vector(node.translation, 3, -10000, 10000),
      rotation: vector(node.rotation, 4, -1, 1),
      scale: vector(node.scale, 3, -100, 100)
    }))
  };
}
