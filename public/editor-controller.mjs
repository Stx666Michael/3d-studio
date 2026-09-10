import {
  exportGLB,
  fromRecipe,
  importGLB,
  poses,
  quat,
  euler
} from './engine.mjs';
import {Renderer} from './renderer.mjs';
import {
  finite,
  LIMITS,
  validateAnimation
} from './contracts.mjs';
import {
  MAX_PROJECT_FILE_BYTES,
  parseProject,
  serializeProject
} from './project.mjs';

const $ = id => document.getElementById(id);
const AXES = ['x', 'y', 'z'];
const EDITABLE_CLIP_CONTROLS = [
  'duplicate',
  'deleteClip',
  'updateClip',
  'clipName',
  'duration',
  'loop'
];
const STARTER_URL = new URL('./assets/starter-owl.glb', import.meta.url);

let renderer;
let doc;
let scenes = [];
let activeSceneId = '';
let selected = null;
let clipId = '';
let time = 0;
let playing = false;
let session = null;
let version = 0;
let job = null;
let last = 0;

const undo = [];
const redo = [];

const active = () => doc?.clips.find(clip => clip.id === clipId) || null;
const activeScene = () => scenes.find(scene => scene.id === activeSceneId);
const node = () => doc?.nodes.find(sceneNode => sceneNode.id === selected);
const copy = documentData => ({
  ...documentData,
  nodes: structuredClone(documentData.nodes),
  clips: structuredClone(documentData.clips)
});

function createEmptyDocument(name = 'Empty workspace') {
  return {
    name,
    nodes: [],
    meshes: [],
    clips: []
  };
}

function createScene(documentData, id = crypto.randomUUID()) {
  return {id, document: documentData};
}

function updateSceneControls() {
  $('sceneSelect').replaceChildren();
  for (const scene of scenes) {
    $('sceneSelect').add(new Option(scene.document.name, scene.id));
  }
  $('sceneSelect').value = activeSceneId;
  $('deleteScene').disabled = scenes.length <= 1;
  $('duplicateScene').disabled = !doc;
}

function activateScene(sceneId) {
  const scene = scenes.find(item => item.id === sceneId);
  if (!scene) {
    throw Error('The selected scene no longer exists.');
  }

  activeSceneId = scene.id;
  undo.length = 0;
  redo.length = 0;
  setDoc(scene.document, {history: false});
}

function addScene(documentData, {select = true, id} = {}) {
  if (scenes.length >= LIMITS.scenes) {
    throw Error(`A project can contain at most ${LIMITS.scenes} scenes.`);
  }

  const scene = createScene(documentData, id);
  scenes.push(scene);
  if (select) {
    activateScene(scene.id);
  } else {
    update();
  }
  return scene;
}

function loadProject(nextProject) {
  if (!nextProject.scenes.length) {
    throw Error('A project must contain at least one scene.');
  }

  scenes = nextProject.scenes;
  activeSceneId = nextProject.activeSceneId;
  undo.length = 0;
  redo.length = 0;
  activateScene(activeSceneId);
}

function duplicateScene() {
  if (!doc) {
    return;
  }

  const duplicate = copy(doc);
  duplicate.name = `${doc.name} copy`;
  addScene(duplicate);
  status(`Duplicated scene: ${duplicate.name}.`);
}

function deleteClip() {
  const clip = active();
  if (!clip || !window.confirm(`Delete "${clip.name}"?`)) {
    return;
  }

  const index = doc.clips.indexOf(clip);
  commit(() => {
    doc.clips.splice(index, 1);
    const nextIndex = Math.min(index, doc.clips.length - 1);
    clipId = nextIndex >= 0 ? doc.clips[nextIndex].id : '';
    time = 0;
  });
  status(`Deleted clip: ${clip.name}.`);
}

function createNewScene() {
  const name = `Scene ${scenes.length + 1}`;
  addScene(createEmptyDocument(name));
  status(`Created scene: ${name}.`);
}

function deleteScene() {
  if (scenes.length <= 1) {
    throw Error('Keep at least one scene in the project.');
  }

  const scene = activeScene();
  if (!scene || !window.confirm(`Delete "${scene.document.name}"?`)) {
    return;
  }

  const index = scenes.indexOf(scene);
  scenes.splice(index, 1);
  const nextScene = scenes[Math.min(index, scenes.length - 1)];
  activeSceneId = nextScene.id;
  activateScene(activeSceneId);
  status(`Deleted scene: ${scene.document.name}.`);
}

function status(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

function handle(callback) {
  return async (...args) => {
    try {
      await callback(...args);
    } catch (error) {
      status(error.message, true);
      console.error('Operation failed:', error.name);
    }
  };
}

function commit(callback, {reload = false} = {}) {
  undo.push(copy(doc));
  if (undo.length > 20) {
    undo.shift();
  }

  redo.length = 0;
  callback();
  version++;
  playing = false;

  if (reload) {
    renderer.setDocument(doc);
  }
  update();
}

function setDoc(documentData, {history = true} = {}) {
  const scene = activeScene();
  if (!scene) {
    throw Error('No active scene is available.');
  }

  if (doc && history) {
    undo.push(copy(doc));
  }

  scene.document = documentData;
  doc = documentData;
  redo.length = 0;
  version++;
  playing = false;
  time = 0;
  selected = doc.nodes.find(sceneNode => !sceneNode.parent)?.id || null;
  clipId = doc.clips[0]?.id || '';
  renderer.setDocument(doc);
  update();
}

function track() {
  const clip = active();
  return clip?.tracks.find(
    item => item.nodeId === selected && item.property === $('property').value
  );
}

function updateTree() {
  const query = $('search').value.toLowerCase();
  $('tree').replaceChildren();

  for (const sceneNode of doc.nodes) {
    if (query && !sceneNode.name.toLowerCase().includes(query)) {
      continue;
    }

    const button = document.createElement('button');
    button.className =
      'treeitem' + (sceneNode.id === selected ? ' selected' : '');
    button.textContent = `${sceneNode.parent ? '↳ ' : '◇ '}${sceneNode.name}`;
    button.title = sceneNode.name;
    button.setAttribute('role', 'listitem');
    button.onclick = () => {
      selected = sceneNode.id;
      playing = false;
      updateTree();
      updateInspector();
      updateKeys();
    };
    $('tree').append(button);
  }

  $('objectCount').textContent = `${doc.nodes.length} nodes`;
}

function updateInspector() {
  const selectedNode = node();
  const clip = active();
  const mode = $('editMode').value;
  const property = $('property').value;
  const pose =
    selectedNode && mode === 'key'
      ? poses(doc, clip, time).get(selectedNode.id)
      : selectedNode;

  $('selectedName').textContent = selectedNode?.name || 'Select an object';
  $('applyTransform').disabled =
    !selectedNode || Boolean(selectedNode.matrix) || (mode === 'key' && !clip);
  $('applyTransform').textContent =
    mode === 'key' ? 'Insert / update keyframe' : 'Apply base transform';

  let value = pose?.[property] || [0, 0, 0];
  if (property === 'rotation') {
    value = euler(value);
  }

  AXES.forEach((axis, index) => {
    $(axis).value = Number(value[index].toFixed(4));
    $(axis).disabled = !selectedNode || Boolean(selectedNode.matrix);
  });

  $('editHint').textContent = selectedNode?.matrix
    ? 'This imported node uses a baked matrix. Its transform is read-only in v0.1.'
    : mode === 'key'
      ? 'Edit local values, then insert a key at the current playhead. Base pose stays unchanged.'
      : 'Editing the rest pose. Existing animation tracks can override these values during playback.';
  $('interpolation').value = track()?.interpolation || 'LINEAR';
}

function updateKeys() {
  $('keys').replaceChildren();
  const currentTrack = track();
  $('trackName').textContent =
    `${node()?.name || 'Select a part'} · ` +
    $('property').selectedOptions[0].textContent;

  if (!currentTrack?.keys.length) {
    const empty = document.createElement('p');
    empty.className = 'small muted';
    empty.textContent =
      'No keyframes on this track. Choose a time and insert a key in the inspector.';
    $('keys').append(empty);
    return;
  }

  for (const [index, key] of currentTrack.keys.entries()) {
    const row = document.createElement('div');
    row.className = 'keyrow';

    const timestamp = document.createElement('span');
    timestamp.className = 'time';
    timestamp.textContent = `${key.time.toFixed(2)} s`;

    const value = document.createElement('span');
    value.className = 'value';
    value.textContent = (
      currentTrack.property === 'rotation' ? euler(key.value) : key.value
    )
      .map(item => item.toFixed(3))
      .join(' / ');

    const edit = document.createElement('button');
    edit.textContent = 'Edit';
    edit.onclick = () => {
      playing = false;
      time = key.time;
      $('editMode').value = 'key';
      syncTime();
      updateInspector();
      status(
        'Key loaded. Change values and reinsert to replace this key; delete it first to move it to another time.'
      );
    };

    const remove = document.createElement('button');
    remove.textContent = 'Delete';
    remove.setAttribute(
      'aria-label',
      `Delete keyframe at ${key.time} seconds`
    );
    remove.onclick = () =>
      commit(() => {
        currentTrack.keys.splice(index, 1);
        if (!currentTrack.keys.length) {
          active().tracks = active().tracks.filter(item => item !== currentTrack);
        }
      });

    row.append(timestamp, value, edit, remove);
    $('keys').append(row);
  }
}

function syncTime() {
  const clip = active();
  $('scrub').max = clip?.duration || 2;
  $('scrub').value = time;
  $('time').value = Number(time.toFixed(3));
  $('timeText').textContent =
    `${time.toFixed(2)} / ${(clip?.duration || 0).toFixed(2)} s`;
  $('play').textContent = playing ? 'Pause' : 'Play';
  $('play').disabled = !clip;
}

function update() {
  if (!doc) {
    return;
  }

  $('projectName').textContent = doc.name;
  updateSceneControls();
  $('clips').replaceChildren(new Option('Base pose / no clip', ''));
  for (const clip of doc.clips) {
    $('clips').add(new Option(clip.name, clip.id));
  }

  $('clips').value = clipId;
  const clip = active();
  $('clipName').value = clip?.name || '';
  $('duration').value = clip ? Number(clip.duration.toFixed(4)) : 2;
  $('loop').checked = clip?.loop ?? true;

  for (const id of EDITABLE_CLIP_CONTROLS) {
    $(id).disabled = !clip;
  }

  $('undo').disabled = !undo.length;
  $('redo').disabled = !redo.length;
  $('meshStats').textContent =
    `${Math.round(
      doc.meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0) / 1000
    )}k triangles`;

  updateTree();
  updateInspector();
  updateKeys();
  syncTime();
}

async function api(url, data, method = 'POST', signal) {
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': session?.csrf || ''
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal
  });
  const result = await response.json();

  if (!response.ok) {
    throw Error(result.error || 'Request failed');
  }
  return result;
}

async function refreshSession() {
  session = await (await fetch('/api/session')).json();
  $('modelId').value = session.model || 'gemini-3.8-flash';
  $('connection').textContent = session.configured
    ? 'Gemini key configured'
    : 'Gemini connection';
  $('keyHint').textContent = session.configured
    ? 'Gemini key configured. Prompts and scene metadata go to Google; meshes stay local.'
    : 'Add a Gemini API key to generate. The starter editor works without one.';
}

function download(data, name, type) {
  const blob = new Blob([data], {type});
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function starter() {
  const response = await fetch(STARTER_URL);
  if (!response.ok) {
    throw Error('Starter asset could not be loaded.');
  }

  const documentData = importGLB(await response.arrayBuffer());
  documentData.name = '3D Studio · Purple owl';
  setDoc(documentData);
  $('loading').hidden = true;
  status('Starter loaded: nine editable animation clips. Select a clip and press Play.');
}

function undoEdit() {
  if (!undo.length) {
    return;
  }

  redo.push(copy(doc));
  doc = undo.pop();
  activeScene().document = doc;
  version++;
  clipId = doc.clips.some(clip => clip.id === clipId)
    ? clipId
    : doc.clips[0]?.id || '';
  selected = doc.nodes.some(sceneNode => sceneNode.id === selected)
    ? selected
    : doc.nodes[0]?.id;
  time = 0;
  playing = false;
  renderer.setDocument(doc);
  update();
  status('Undid last edit.');
}

function redoEdit() {
  if (!redo.length) {
    return;
  }

  undo.push(copy(doc));
  doc = redo.pop();
  activeScene().document = doc;
  version++;
  time = 0;
  playing = false;
  clipId = doc.clips.some(clip => clip.id === clipId)
    ? clipId
    : doc.clips[0]?.id || '';
  selected = doc.nodes.some(sceneNode => sceneNode.id === selected)
    ? selected
    : doc.nodes[0]?.id;
  renderer.setDocument(doc);
  update();
  status('Redid edit.');
}

function changePlayhead(event) {
  playing = false;
  const value = Number(event.target.value);
  time = Number.isFinite(value)
    ? Math.max(0, Math.min(active()?.duration || 2, value))
    : 0;
  syncTime();
  updateInspector();
}

function updateClip() {
  const clip = active();
  if (!clip) {
    return;
  }

  const duration = Number($('duration').value);
  const name = $('clipName').value.trim();
  if (!finite(duration, 0.1, 30) || !name || name.length > 120) {
    throw Error('Use a name up to 120 characters and a duration of 0.1–30 seconds.');
  }
  if (clip.tracks.some(item => item.keys.some(key => key.time > duration + 0.00001))) {
    throw Error('Move or delete keys beyond the new duration first.');
  }

  const interpolation = $('interpolation').value;
  commit(() => {
    clip.name = name;
    clip.duration = duration;
    for (const trackItem of clip.tracks) {
      for (const key of trackItem.keys) {
        key.time = Math.min(key.time, duration);
      }
    }
    if (track()) {
      track().interpolation = interpolation;
    }
    time = Math.min(time, duration);
  });
  status('Clip settings updated.');
}

function applyTransform() {
  const selectedNode = node();
  if (!selectedNode || selectedNode.matrix) {
    return;
  }

  const property = $('property').value;
  let value = AXES.map(axis => Number($(axis).value));
  if (
    value.some(item => !finite(item, -100, 100)) ||
    (property === 'scale' && value.some(item => item <= 0.001))
  ) {
    throw Error('Use finite values from −100 to 100 and positive scales above 0.001.');
  }
  if (property === 'rotation') {
    value = quat(value);
  }

  if ($('editMode').value === 'base') {
    commit(() => {
      selectedNode[property] = value;
    });
  } else {
    const clip = active();
    if (!clip) {
      throw Error('Create or select an animation clip.');
    }

    commit(() => {
      let currentTrack = track();
      if (!currentTrack) {
        currentTrack = {
          nodeId: selectedNode.id,
          property,
          interpolation: $('interpolation').value,
          keys: []
        };
        clip.tracks.push(currentTrack);
      }

      const key = currentTrack.keys.find(
        item => Math.abs(item.time - time) < 0.0001
      );
      if (key) {
        key.value = value;
      } else {
        currentTrack.keys.push({time, value});
      }
      currentTrack.keys.sort((a, b) => a.time - b.time);
    });
  }

  status(`Updated ${selectedNode.name} ${property}.`);
}

async function importFile() {
  const file = $('file').files[0];
  if (!file) {
    return;
  }

  try {
    if (file.name.endsWith('.glb')) {
      const documentData = importGLB(await file.arrayBuffer());
      documentData.name = file.name.replace(/\.glb$/, '');
      addScene(documentData);
      status(
        `Imported ${file.name} as a new scene. Unsupported rigs/textures are rejected rather than silently removed.`
      );
    } else if (file.name.endsWith('.3ds')) {
      if (file.size > MAX_PROJECT_FILE_BYTES) {
        throw Error('Project file too large.');
      }

      loadProject(parseProject(await file.text()));
      status(
        `Imported ${file.name} with ${scenes.length} scene${
          scenes.length === 1 ? '' : 's'
        }.`
      );
    } else {
      throw Error('Use .glb or a saved .3ds project.');
    }
  } finally {
    $('file').value = '';
  }
}

function saveProject() {
  download(
    serializeProject(scenes, activeSceneId),
    'my_project.3ds',
    'application/json'
  );
  status(
    `Project downloaded with ${scenes.length} scene${
      scenes.length === 1 ? '' : 's'
    }. Keep this file to resume later; this MVP has no cloud storage.`
  );
}

function buildManifest() {
  return {
    nodes: doc.nodes
      .filter(sceneNode => !sceneNode.matrix)
      .map(sceneNode => ({
        id: sceneNode.id,
        name: sceneNode.name,
        translation: sceneNode.translation,
        rotation: sceneNode.rotation,
        scale: sceneNode.scale
      }))
  };
}

function buildCandidate(kind, result, manifest, sourceClip) {
  if (kind === 'model') {
    return {document: fromRecipe(result), clipId: ''};
  }

  const clip = validateAnimation(result, manifest);
  const candidate = copy(doc);
  if (kind === 'revise') {
    clip.id = sourceClip;
    candidate.clips = candidate.clips.map(existing =>
      existing.id === sourceClip ? clip : existing
    );
  } else {
    candidate.clips.push(clip);
  }

  return {
    document: candidate,
    clipId:
      candidate.clips[
        kind === 'revise'
          ? candidate.clips.findIndex(existing => existing.id === sourceClip)
          : candidate.clips.length - 1
      ]?.id
  };
}

function setGenerationState(active, kind = '') {
  $('generationState').hidden = !active;
  if (!active) {
    $('generate').removeAttribute('aria-busy');
    return;
  }

  $('generate').setAttribute('aria-busy', 'true');
  $('generationMessage').textContent =
    kind === 'model'
      ? 'Generating model geometry with Gemini…'
      : 'Generating animation with Gemini…';
}

function updateGeneratedJson(kind, result) {
  const isObject = kind === 'model';
  const toggle = $(isObject ? 'showObjectJson' : 'showAnimationJson');
  const output = $(isObject ? 'objectJson' : 'animationJson');

  output.textContent = JSON.stringify(result, null, 2);
  toggle.disabled = false;
  output.hidden = !toggle.checked;
}

function syncGeneratedJson(toggleId, outputId) {
  $(outputId).hidden = !$(toggleId).checked;
}

async function generate() {
  if (!session?.configured) {
    $('connectionDialog').showModal();
    return;
  }

  const kind = $('kind').value;
  const prompt = $('prompt').value.trim();
  if (prompt.length < 3) {
    throw Error('Describe what you want to generate.');
  }
  if (kind === 'revise' && !active()) {
    throw Error('Select an existing animation to revise.');
  }

  const revision = version;
  const sourceClip = clipId;
  job = new AbortController();
  $('generate').disabled = true;
  $('cancelJob').hidden = false;
  setGenerationState(true, kind);
  status(
    `Gemini is generating validated ${
      kind === 'model' ? 'model geometry' : 'animation tracks'
    }…`
  );

  try {
    const manifest = buildManifest();
    const response = await api(
      '/api/generate',
      {
        kind: kind === 'model' ? 'model' : 'animation',
        prompt,
        manifest,
        activeClip: kind === 'revise' ? active() : undefined
      },
      'POST',
      job.signal
    );

    if (version !== revision) {
      throw Error(
        'The project changed while Gemini was working. No result was applied. Regenerate against the current revision.'
      );
    }

    const candidate = buildCandidate(kind, response.result, manifest, sourceClip);
    setDoc(candidate.document);
    clipId = candidate.clipId || doc.clips[0]?.id || '';
    time = 0;
    update();
    updateGeneratedJson(kind, response.result);
    status(
      kind === 'model'
        ? 'Applied the generated model directly to the project. Undo will restore the previous scene.'
        : `Applied the generated ${
            kind === 'revise' ? 'clip revision' : 'animation'
          } directly to the project.`
    );
  } catch (error) {
    if (error.name === 'AbortError') {
      status('Generation cancelled. Project unchanged.');
    } else {
      throw error;
    }
  } finally {
    job = null;
    $('generate').disabled = false;
    $('cancelJob').hidden = true;
    setGenerationState(false);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden || now - last < 32) {
    return;
  }

  const delta = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!doc) {
    return;
  }

  const clip = active();
  if (playing && clip) {
    time += delta * Number($('speed').value);
    if (time > clip.duration) {
      if (clip.loop) {
        time %= clip.duration;
      } else {
        time = clip.duration;
        playing = false;
        updateInspector();
      }
    }
    syncTime();
  }

  renderer.render(poses(doc, clip, time), selected);
}

function updateExportAnimationOptions() {
  const scene = scenes.find(item => item.id === $('exportScene').value) ||
    activeScene();
  $('exportAnimation').replaceChildren(
    new Option('Base pose / no animation', ''),
    new Option('All animations', '__all__')
  );

  if (!scene) {
    return;
  }

  for (const clip of scene.document.clips) {
    $('exportAnimation').add(new Option(clip.name, clip.id));
  }

  const preferred =
    scene.id === activeSceneId && scene.document.clips.some(item => item.id === clipId)
      ? clipId
      : '__all__';
  $('exportAnimation').value = preferred;
}

function openExportDialog() {
  $('exportScene').replaceChildren();
  for (const scene of scenes) {
    $('exportScene').add(new Option(scene.document.name, scene.id));
  }
  $('exportScene').value = activeSceneId;
  updateExportAnimationOptions();
  $('exportDialog').showModal();
}

function safeExportName(name) {
  return (
    name
      .trim()
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'scene'
  );
}

async function exportSelected(event) {
  event.preventDefault();
  const scene = scenes.find(item => item.id === $('exportScene').value);
  if (!scene) {
    throw Error('Choose a scene to export.');
  }

  const animationId = $('exportAnimation').value;
  download(
    exportGLB(scene.document, {animationId}),
    `${safeExportName(scene.document.name)}.glb`,
    'model/gltf-binary'
  );
  $('exportDialog').close();
  const animationLabel =
    animationId === ''
      ? 'base pose'
      : animationId === '__all__'
        ? 'all animations'
        : scene.document.clips.find(clip => clip.id === animationId)?.name ||
          'selected animation';
  status(`Exported ${scene.document.name} with ${animationLabel}.`);
}

function initializeControls() {
  $('starter').onclick = handle(starter);
  $('sceneSelect').onchange = handle(() =>
    activateScene($('sceneSelect').value)
  );
  $('newScene').onclick = handle(createNewScene);
  $('duplicateScene').onclick = handle(duplicateScene);
  $('deleteScene').onclick = handle(deleteScene);
  $('fit').onclick = () => renderer.fit();
  $('search').oninput = updateTree;
  $('undo').onclick = undoEdit;
  $('redo').onclick = redoEdit;
  $('clips').onchange = () => {
    clipId = $('clips').value;
    time = 0;
    playing = false;
    update();
  };
  $('play').onclick = () => {
    if (active()) {
      playing = !playing;
    }
    syncTime();
  };
  $('stop').onclick = () => {
    playing = false;
    time = 0;
    syncTime();
    updateInspector();
  };
  $('scrub').oninput = changePlayhead;
  $('time').oninput = changePlayhead;
  $('loop').onchange = () => {
    const value = $('loop').checked;
    commit(() => {
      active().loop = value;
    });
  };
  $('newClip').onclick = () =>
    commit(() => {
      const clip = {
        id: crypto.randomUUID(),
        name: `Animation ${doc.clips.length + 1}`,
        duration: 2,
        loop: true,
        tracks: []
      };
      doc.clips.push(clip);
      clipId = clip.id;
      time = 0;
    });
  $('deleteClip').onclick = handle(deleteClip);
  $('duplicate').onclick = () => {
    const clip = active();
    if (clip) {
      commit(() => {
        const duplicate = structuredClone(clip);
        duplicate.id = crypto.randomUUID();
        duplicate.name = `${clip.name} copy`;
        doc.clips.push(duplicate);
        clipId = duplicate.id;
      });
    }
  };
  $('updateClip').onclick = handle(updateClip);
  $('property').onchange = () => {
    updateInspector();
    updateKeys();
  };
  $('editMode').onchange = updateInspector;
  $('applyTransform').onclick = handle(applyTransform);
  $('import').onclick = () => $('file').click();
  $('file').onchange = handle(importFile);
  $('export').onclick = openExportDialog;
  $('exportScene').onchange = updateExportAnimationOptions;
  $('exportForm').onsubmit = handle(exportSelected);
  $('save').onclick = handle(saveProject);
  $('connection').onclick = () => $('connectionDialog').showModal();

  document.querySelectorAll('[data-close]').forEach(button => {
    button.onclick = () => {
      $(button.dataset.close).close();
      $('apiKey').value = '';
    };
  });

  $('connectionForm').onsubmit = async event => {
    event.preventDefault();
    $('connectionError').textContent = '';
    try {
      await api('/api/connection', {
        key: $('apiKey').value.trim(),
        model: $('modelId').value.trim()
      });
      $('apiKey').value = '';
      await refreshSession();
      $('connectionDialog').close();
      status(
        'Key saved in server memory for this session. Google access will be verified on generation.'
      );
    } catch (error) {
      $('connectionError').textContent = error.message;
    }
  };

  $('disconnect').onclick = handle(async () => {
    await api('/api/connection', undefined, 'DELETE');
    $('apiKey').value = '';
    await refreshSession();
    $('connectionDialog').close();
    status(
      session.configured
        ? 'Session key removed. Server environment key remains configured.'
        : 'Gemini session key forgotten.'
    );
  });
  $('connectionDialog').addEventListener('close', () => {
    $('apiKey').value = '';
  });

  document.querySelectorAll('[data-prompt]').forEach(button => {
    button.onclick = () => {
      $('prompt').value = button.dataset.prompt;
      $('kind').value = button.dataset.kind;
    };
  });

  $('generate').onclick = handle(generate);
  $('cancelJob').onclick = () => job?.abort();
  $('showAnimationJson').onchange = () =>
    syncGeneratedJson('showAnimationJson', 'animationJson');
  $('showObjectJson').onchange = () =>
    syncGeneratedJson('showObjectJson', 'objectJson');
}

window.addEventListener('beforeunload', event => {
  if (version > 1) {
    event.preventDefault();
    event.returnValue = '';
  }
});

initializeControls();

(async () => {
  try {
    renderer = new Renderer($('canvas'));
    await refreshSession();
    const initialScene = createScene(createEmptyDocument());
    scenes = [initialScene];
    activeSceneId = initialScene.id;
    setDoc(initialScene.document, {history: false});
    $('loading').hidden = true;
    status(
      'Empty workspace ready. Load Starter owl, import a model as a new scene, or generate one with Gemini.'
    );
    requestAnimationFrame(frame);
    window.studioReady = true;
    window.studio3d = {
      getDocument: () => doc,
      getScenes: () =>
        scenes.map(scene => ({
          id: scene.id,
          name: scene.document.name,
          document: scene.document
        })),
      getState: () => ({
        selected,
        clipId,
        time,
        playing,
        version,
        activeSceneId
      }),
      setDocument: setDoc,
      exportGLB: () => exportGLB(doc)
    };
  } catch (error) {
    $('loading').textContent = error.message;
    status(error.message, true);
  }
})();
