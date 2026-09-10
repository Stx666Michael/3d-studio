import {exportGLB, importGLB} from './engine.mjs';
import {LIMITS, validateRecipe} from './contracts.mjs';

export const PROJECT_FORMAT = '3d-studio-project';
export const PROJECT_VERSION = 1;
export const MAX_PROJECT_GLB_LENGTH = Math.ceil(LIMITS.upload / 3) * 4;
export const MAX_PROJECT_FILE_BYTES =
  MAX_PROJECT_GLB_LENGTH * LIMITS.scenes + 1024 * 1024;

function encodeBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const parts = [];
  for (let index = 0; index < bytes.length; index += 32768) {
    parts.push(String.fromCharCode(...bytes.subarray(index, index + 32768)));
  }
  return btoa(parts.join(''));
}

function decodeBase64(value) {
  if (
    typeof value !== 'string' ||
    value.length > MAX_PROJECT_GLB_LENGTH ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw Error('Invalid or oversized embedded GLB.');
  }

  let binary;
  try {
    binary = atob(value);
  } catch {
    throw Error('Invalid embedded GLB data.');
  }
  if (binary.length > LIMITS.upload) {
    throw Error('Embedded GLB exceeds the 50 MB limit.');
  }

  return Uint8Array.from(binary, character => character.charCodeAt(0)).buffer;
}

function validateSceneId(id, ids) {
  if (
    typeof id !== 'string' ||
    !id.trim() ||
    id.length > 120 ||
    ids.has(id)
  ) {
    throw Error('Project scene IDs must be unique non-empty strings.');
  }
}

function validateSceneName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 120) {
    throw Error('Project scene names must be 1–120 characters.');
  }
  return name.trim();
}

function parseSceneEntry(entry, ids) {
  if (!entry || typeof entry !== 'object') {
    throw Error('Invalid project scene.');
  }

  validateSceneId(entry.id, ids);
  const name = validateSceneName(entry.name);
  const document = importGLB(decodeBase64(entry.glb));
  document.name = name;

  if (entry.recipe !== undefined && entry.recipe !== null) {
    document.recipe = validateRecipe(entry.recipe);
  }

  ids.add(entry.id);
  return {id: entry.id, document};
}

export function serializeProject(scenes, activeSceneId) {
  if (
    !Array.isArray(scenes) ||
    !scenes.length ||
    scenes.length > LIMITS.scenes
  ) {
    throw Error(`Projects must contain 1–${LIMITS.scenes} scenes.`);
  }

  const ids = new Set();
  const entries = scenes.map(scene => {
    if (!scene || !scene.document) {
      throw Error('Invalid project scene.');
    }

    validateSceneId(scene.id, ids);
    const name = validateSceneName(scene.document.name);
    const glb = encodeBase64(exportGLB(scene.document));
    if (glb.length > MAX_PROJECT_GLB_LENGTH) {
      throw Error('A scene exceeds the maximum project GLB size.');
    }

    ids.add(scene.id);
    return {
      id: scene.id,
      name,
      glb,
      recipe: scene.document.recipe || null
    };
  });

  const project = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    activeSceneId: ids.has(activeSceneId) ? activeSceneId : entries[0].id,
    scenes: entries
  };
  const json = JSON.stringify(project);
  if (json.length > MAX_PROJECT_FILE_BYTES) {
    throw Error('Project file too large.');
  }

  return json;
}

export function parseProject(input) {
  if (typeof input === 'string' && input.length > MAX_PROJECT_FILE_BYTES) {
    throw Error('Project file too large.');
  }

  let project;
  if (typeof input === 'string') {
    try {
      project = JSON.parse(input);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw Error('Invalid project JSON.');
      }
      throw error;
    }
  } else {
    project = input;
  }

  if (!project || project.format !== PROJECT_FORMAT) {
    throw Error('Not a supported 3D Studio project.');
  }
  if (project.version !== PROJECT_VERSION) {
    throw Error('Not a supported 3D Studio project.');
  }
  if (
    !Array.isArray(project.scenes) ||
    !project.scenes.length ||
    project.scenes.length > LIMITS.scenes
  ) {
    throw Error(`Projects must contain 1–${LIMITS.scenes} scenes.`);
  }

  const ids = new Set();
  const scenes = project.scenes.map(entry => parseSceneEntry(entry, ids));
  const activeSceneId = ids.has(project.activeSceneId)
    ? project.activeSceneId
    : scenes[0].id;

  return {scenes, activeSceneId};
}
