import {LIMITS, validateRecipe} from './contracts.mjs';

export const identity = () => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
];

export function multiply(a, b) {
  const output = Array(16).fill(0);

  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      for (let inner = 0; inner < 4; inner++) {
        output[column * 4 + row] +=
          a[inner * 4 + row] * b[column * 4 + inner];
      }
    }
  }

  return output;
}

export function compose(translation, rotation, scale) {
  const [x, y, z, w] = rotation;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;

  return [
    (1 - 2 * (yy + zz)) * scale[0],
    2 * (x * y + z * w) * scale[0],
    2 * (x * z - y * w) * scale[0],
    0,
    2 * (x * y - z * w) * scale[1],
    (1 - 2 * (xx + zz)) * scale[1],
    2 * (y * z + x * w) * scale[1],
    0,
    2 * (x * z + y * w) * scale[2],
    2 * (y * z - x * w) * scale[2],
    (1 - 2 * (xx + yy)) * scale[2],
    0,
    ...translation,
    1
  ];
}

export function quat(eulerDegrees) {
  const [x, y, z] = eulerDegrees.map(value => (value * Math.PI) / 360);
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cz = Math.cos(z);
  const sz = Math.sin(z);

  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz
  ];
}

export function euler(rotation) {
  const [x, y, z, w] = rotation;
  return [
    Math.atan2(
      2 * (w * x + y * z),
      1 - 2 * (x * x + y * y)
    ),
    Math.asin(
      Math.max(-1, Math.min(1, 2 * (w * y - z * x)))
    ),
    Math.atan2(
      2 * (w * z + x * y),
      1 - 2 * (y * y + z * z)
    )
  ].map(value => (value * 180) / Math.PI);
}

export function slerp(a, b, amount) {
  let dotProduct = a.reduce((sum, value, index) => sum + value * b[index], 0);
  if (dotProduct < 0) {
    b = b.map(value => -value);
    dotProduct = -dotProduct;
  }

  let output;
  if (dotProduct > 0.9995) {
    output = a.map((value, index) => value + amount * (b[index] - value));
  } else {
    const angle = Math.acos(Math.min(1, dotProduct));
    const sine = Math.sin(angle);
    output = a.map(
      (value, index) =>
        (Math.sin((1 - amount) * angle) * value +
          Math.sin(amount * angle) * b[index]) /
        sine
    );
  }

  const length = Math.hypot(...output) || 1;
  return output.map(value => value / length);
}

export function sampleTrack(track, time) {
  const keys = track.keys;
  if (!keys.length) {
    return null;
  }
  if (time <= keys[0].time) {
    return [...keys[0].value];
  }

  const lastKey = keys[keys.length - 1];
  if (time >= lastKey.time) {
    return [...lastKey.value];
  }

  const index = keys.findIndex(key => key.time > time);
  const previous = keys[index - 1];
  const next = keys[index];
  if (track.interpolation === 'STEP') {
    return [...previous.value];
  }

  const amount = (time - previous.time) / (next.time - previous.time);
  return track.property === 'rotation'
    ? slerp(previous.value, next.value, amount)
    : previous.value.map(
        (value, component) =>
          value + (next.value[component] - value) * amount
      );
}

export function poses(document, clip, time) {
  const output = new Map(
    document.nodes.map(sceneNode => [
      sceneNode.id,
      {
        translation: [...sceneNode.translation],
        rotation: [...sceneNode.rotation],
        scale: [...sceneNode.scale]
      }
    ])
  );

  if (clip) {
    for (const track of clip.tracks) {
      const pose = output.get(track.nodeId);
      const value = sampleTrack(track, time);
      if (pose && value) {
        pose[track.property] = value;
      }
    }
  }

  return output;
}

export function worlds(document, poseMap) {
  const nodes = new Map(document.nodes.map(sceneNode => [sceneNode.id, sceneNode]));
  const cache = new Map();
  const visiting = new Set();

  function calculate(nodeId) {
    if (cache.has(nodeId)) {
      return cache.get(nodeId);
    }
    if (visiting.has(nodeId)) {
      throw Error('Cyclic node hierarchy.');
    }

    visiting.add(nodeId);
    const sceneNode = nodes.get(nodeId);
    if (!sceneNode) {
      throw Error('Missing parent node.');
    }

    const pose = poseMap?.get(nodeId) || sceneNode;
    let matrix =
      sceneNode.matrix ||
      compose(pose.translation, pose.rotation, pose.scale);
    if (sceneNode.parent) {
      matrix = multiply(calculate(sceneNode.parent), matrix);
    }

    visiting.delete(nodeId);
    cache.set(nodeId, matrix);
    return matrix;
  }

  for (const sceneNode of document.nodes) {
    calculate(sceneNode.id);
  }

  return cache;
}

function normalMatrix(matrix) {
  const a = matrix[0];
  const b = matrix[4];
  const c = matrix[8];
  const d = matrix[1];
  const e = matrix[5];
  const f = matrix[9];
  const g = matrix[2];
  const h = matrix[6];
  const i = matrix[10];
  const determinant =
    a * (e * i - f * h) -
    b * (d * i - f * g) +
    c * (d * h - e * g);

  if (Math.abs(determinant) < 1e-12) {
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }

  return [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d
  ].map(value => value / determinant);
}

export function point(matrix, position) {
  return [
    matrix[0] * position[0] +
      matrix[4] * position[1] +
      matrix[8] * position[2] +
      matrix[12],
    matrix[1] * position[0] +
      matrix[5] * position[1] +
      matrix[9] * position[2] +
      matrix[13],
    matrix[2] * position[0] +
      matrix[6] * position[1] +
      matrix[10] * position[2] +
      matrix[14]
  ];
}

const normalize = vector => {
  const length = Math.hypot(...vector) || 1;
  return vector.map(value => value / length);
};

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];

const dot = (a, b) =>
  a.reduce((sum, value, index) => sum + value * b[index], 0);

function normals(vertices, indices) {
  const output = Array(vertices.length).fill(0);

  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index] * 3;
    const b = indices[index + 1] * 3;
    const c = indices[index + 2] * 3;
    const ab = [0, 1, 2].map(component => vertices[b + component] - vertices[a + component]);
    const ac = [0, 1, 2].map(component => vertices[c + component] - vertices[a + component]);
    const faceNormal = cross(ab, ac);

    for (const vertex of [a, b, c]) {
      for (let component = 0; component < 3; component++) {
        output[vertex + component] += faceNormal[component];
      }
    }
  }

  for (let index = 0; index < output.length; index += 3) {
    const normal = normalize(output.slice(index, index + 3));
    output.splice(index, 3, ...normal);
  }

  return output;
}

const srgb = value =>
  value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;

const BOX_FACES = [
  [[1, 0, 0], [1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]],
  [[-1, 0, 0], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]],
  [[0, 1, 0], [-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]],
  [[0, -1, 0], [-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]],
  [[0, 0, 1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
  [[0, 0, -1], [1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]
];

function boxPrimitive() {
  const positions = [];
  const vertexNormals = [];
  const indices = [];

  for (const face of BOX_FACES) {
    const offset = positions.length / 3;
    for (const position of face.slice(1)) {
      positions.push(...position);
      vertexNormals.push(...face[0]);
    }
    indices.push(
      offset,
      offset + 1,
      offset + 2,
      offset,
      offset + 2,
      offset + 3
    );
  }

  return {positions, normals: vertexNormals, indices};
}

function roundPrimitive(shape) {
  const positions = [];
  const vertexNormals = [];
  const indices = [];
  const horizontalSegments = 40;
  const verticalSegments = shape === 'sphere' ? 28 : 12;

  for (let row = 0; row <= verticalSegments; row++) {
    const vertical = row / verticalSegments;
    const y =
      shape === 'sphere' ? Math.cos(Math.PI * vertical) : 1 - 2 * vertical;
    const radius =
      shape === 'sphere'
        ? Math.sin(Math.PI * vertical)
        : shape === 'cone'
          ? vertical
          : 1;

    for (let column = 0; column <= horizontalSegments; column++) {
      const angle = (column / horizontalSegments) * 2 * Math.PI;
      const x = radius * Math.cos(angle);
      const z = radius * Math.sin(angle);
      positions.push(x, y, z);
      vertexNormals.push(
        ...normalize(
          shape === 'sphere'
            ? [x, y, z]
            : [Math.cos(angle), shape === 'cone' ? 0.5 : 0, Math.sin(angle)]
        )
      );
    }
  }

  for (let row = 0; row < verticalSegments; row++) {
    for (let column = 0; column < horizontalSegments; column++) {
      const first = row * (horizontalSegments + 1) + column;
      const second = first + horizontalSegments + 1;
      indices.push(first, second, first + 1, first + 1, second, second + 1);
    }
  }

  if (shape !== 'sphere') {
    for (const top of [true, false]) {
      const y = top ? 1 : -1;
      const radius = shape === 'cone' && top ? 0 : 1;
      if (!radius) {
        continue;
      }

      const center = positions.length / 3;
      positions.push(0, y, 0);
      vertexNormals.push(0, top ? 1 : -1, 0);

      for (let column = 0; column <= horizontalSegments; column++) {
        const angle = (column / horizontalSegments) * 2 * Math.PI;
        positions.push(radius * Math.cos(angle), y, radius * Math.sin(angle));
        vertexNormals.push(0, top ? 1 : -1, 0);
      }

      for (let column = 0; column < horizontalSegments; column++) {
        indices.push(
          center,
          center + 1 + column + (top ? 1 : 0),
          center + 1 + column + (top ? 0 : 1)
        );
      }
    }
  }

  let volume = 0;
  for (let index = 0; index < indices.length; index += 3) {
    const a = positions.slice(indices[index] * 3, indices[index] * 3 + 3);
    const b = positions.slice(
      indices[index + 1] * 3,
      indices[index + 1] * 3 + 3
    );
    const c = positions.slice(
      indices[index + 2] * 3,
      indices[index + 2] * 3 + 3
    );
    volume += dot(a, cross(b, c));
  }

  if (volume < 0) {
    for (let index = 0; index < indices.length; index += 3) {
      [indices[index + 1], indices[index + 2]] = [
        indices[index + 2],
        indices[index + 1]
      ];
    }
  }

  return {positions, normals: vertexNormals, indices};
}

export function primitive(shape) {
  const geometry = shape === 'box' ? boxPrimitive() : roundPrimitive(shape);
  return {
    ...geometry,
    color: [0.5, 0.3, 0.8, 1],
    roughness: 0.8
  };
}

function colorFromHex(color) {
  return [
    ...color
      .slice(1)
      .match(/../g)
      .map(value => srgb(parseInt(value, 16) / 255)),
    1
  ];
}

export function fromRecipe(input) {
  const recipe = validateRecipe(input);
  const nodes = [
    {
      id: 'scene::root',
      name: recipe.name,
      parent: null,
      translation: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      meshes: []
    }
  ];
  const meshes = [];

  for (const part of recipe.parts) {
    const mesh = primitive(part.shape);
    mesh.color = colorFromHex(part.color);
    const meshIndex = meshes.push(mesh) - 1;

    nodes.push({
      id: part.id,
      name: part.name,
      parent: 'scene::root',
      translation: part.pivot,
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
      meshes: []
    });
    nodes.push({
      id: `geometry::${part.id}`,
      name: `${part.name} geometry`,
      parent: part.id,
      translation: part.position.map(
        (value, index) => value - part.pivot[index]
      ),
      rotation: quat(part.rotation),
      scale: part.scale,
      meshes: [meshIndex]
    });
  }

  return {
    name: recipe.name,
    nodes,
    meshes,
    clips: [],
    recipe
  };
}

const COMPONENT_WIDTHS = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16
};

const COMPONENT_TYPES = {
  5120: ['getInt8', 1],
  5121: ['getUint8', 1],
  5122: ['getInt16', 2],
  5123: ['getUint16', 2],
  5125: ['getUint32', 4],
  5126: ['getFloat32', 4]
};

function readAccessorFactory(gltf, binary) {
  return function readAccessor(index) {
    const accessor = gltf.accessors?.[index];
    if (
      !accessor ||
      accessor.sparse ||
      accessor.bufferView == null ||
      !COMPONENT_TYPES[accessor.componentType] ||
      !COMPONENT_WIDTHS[accessor.type]
    ) {
      throw Error('Unsupported GLB accessor.');
    }

    const bufferView = gltf.bufferViews[accessor.bufferView];
    const componentWidth = COMPONENT_WIDTHS[accessor.type];
    const componentType = COMPONENT_TYPES[accessor.componentType];
    if (
      !bufferView ||
      bufferView.buffer !== 0 ||
      !Number.isInteger(accessor.count) ||
      accessor.count < 0 ||
      accessor.count * componentWidth > 2000000
    ) {
      throw Error('Accessor exceeds limits.');
    }

    const componentBytes = componentType[1];
    const stride = bufferView.byteStride || componentWidth * componentBytes;
    const offset =
      (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
    const length = accessor.count
      ? (accessor.count - 1) * stride + componentWidth * componentBytes
      : 0;
    if (
      offset < 0 ||
      stride < componentWidth * componentBytes ||
      offset + length > binary.byteLength ||
      offset + length > (bufferView.byteOffset || 0) + bufferView.byteLength
    ) {
      throw Error('Accessor out of bounds.');
    }

    const view = new DataView(binary);
    const output = [];
    for (let item = 0; item < accessor.count; item++) {
      for (let component = 0; component < componentWidth; component++) {
        let value = view[componentType[0]](
          offset + item * stride + component * componentBytes,
          true
        );
        if (accessor.normalized) {
          const max = {
            5120: 127,
            5121: 255,
            5122: 32767,
            5123: 65535
          }[accessor.componentType];
          if (!max) {
            throw Error('Unsupported normalization.');
          }
          value = Math.max(-1, value / max);
        }
        if (!Number.isFinite(value)) {
          throw Error('Non-finite asset data.');
        }
        output.push(value);
      }
    }

    return output;
  };
}

function parseGLBChunks(buffer) {
  const data = new DataView(buffer);
  if (
    buffer.byteLength < 20 ||
    data.getUint32(0, true) !== 0x46546c67 ||
    data.getUint32(4, true) !== 2 ||
    data.getUint32(8, true) !== buffer.byteLength
  ) {
    throw Error('Choose a valid glTF 2.0 binary (.glb).');
  }

  let gltf;
  let binary;
  for (let offset = 12; offset < buffer.byteLength; ) {
    const length = data.getUint32(offset, true);
    const kind = data.getUint32(offset + 4, true);
    offset += 8;

    if (offset + length > buffer.byteLength) {
      throw Error('Truncated GLB.');
    }
    if (kind === 0x4e4f534a) {
      gltf = JSON.parse(
        new TextDecoder().decode(new Uint8Array(buffer, offset, length))
      );
    }
    if (kind === 0x004e4942) {
      binary = buffer.slice(offset, offset + length);
    }
    offset += length;
  }

  if (!gltf || !binary) {
    throw Error('Missing GLB data.');
  }
  return {gltf, binary};
}

function readGLBMeshes(gltf, readAccessor) {
  const meshes = [];
  const meshMap = [];
  let vertexCount = 0;
  let triangleCount = 0;

  for (const mesh of gltf.meshes || []) {
    if (mesh.primitives.length !== 1) {
      throw Error(
        'Multiple primitives per mesh are not supported in v0.1. Export separate mesh objects.'
      );
    }

    const mappedMeshes = [];
    for (const primitiveMesh of mesh.primitives) {
      if (
        (primitiveMesh.mode ?? 4) !== 4 ||
        primitiveMesh.targets ||
        primitiveMesh.extensions
      ) {
        throw Error(
          'Only triangle primitives without morph targets or compression are supported.'
        );
      }
      if (
        gltf.accessors[primitiveMesh.attributes.POSITION]?.type !== 'VEC3'
      ) {
        throw Error('Invalid positions.');
      }

      const positions = readAccessor(primitiveMesh.attributes.POSITION);
      const indices =
        primitiveMesh.indices != null
          ? readAccessor(primitiveMesh.indices)
          : Array.from({length: positions.length / 3}, (_, index) => index);
      vertexCount += positions.length / 3;
      triangleCount += indices.length / 3;

      if (
        vertexCount > LIMITS.vertices ||
        triangleCount > LIMITS.triangles ||
        indices.length % 3 ||
        indices.some(
          index =>
            !Number.isInteger(index) ||
            index < 0 ||
            index >= positions.length / 3
        )
      ) {
        throw Error('Geometry exceeds limits or has invalid indices.');
      }

      const material = gltf.materials?.[primitiveMesh.material];
      const materialProperties = material?.pbrMetallicRoughness || {};
      if (material?.alphaMode && material.alphaMode !== 'OPAQUE') {
        throw Error('Transparent materials are not supported in v0.1.');
      }

      const vertexNormals =
        primitiveMesh.attributes.NORMAL != null
          ? readAccessor(primitiveMesh.attributes.NORMAL)
          : normals(positions, indices);
      if (vertexNormals.length !== positions.length) {
        throw Error('Invalid normal count.');
      }

      let colors =
        primitiveMesh.attributes.COLOR_0 != null
          ? readAccessor(primitiveMesh.attributes.COLOR_0)
          : null;
      if (
        colors &&
        gltf.accessors[primitiveMesh.attributes.COLOR_0].type === 'VEC4'
      ) {
        colors = colors.filter((_, index) => index % 4 !== 3);
      }
      if (colors && colors.length !== positions.length) {
        throw Error('Invalid vertex colour count.');
      }

      mappedMeshes.push(meshes.length);
      meshes.push({
        positions,
        normals: vertexNormals,
        indices,
        color: materialProperties.baseColorFactor || [1, 1, 1, 1],
        roughness: materialProperties.roughnessFactor ?? 0.8,
        colors
      });
    }
    meshMap.push(mappedMeshes);
  }

  return {meshes, meshMap};
}

function readGLBNodes(gltf, meshMap) {
  const nodes = (gltf.nodes || []).map((node, index) => ({
    id: `n${index}`,
    name: (node.name || `Object ${index + 1}`).slice(0, 120),
    parent: null,
    translation: node.translation || [0, 0, 0],
    rotation: node.rotation || [0, 0, 0, 1],
    scale: node.scale || [1, 1, 1],
    matrix: node.matrix || null,
    meshes: meshMap[node.mesh] || []
  }));

  for (const [index, node] of (gltf.nodes || []).entries()) {
    for (const child of node.children || []) {
      if (!nodes[child] || nodes[child].parent != null) {
        throw Error('Invalid node hierarchy.');
      }
      nodes[child].parent = `n${index}`;
    }
  }

  for (const node of nodes) {
    for (const [property, size] of [
      ['translation', 3],
      ['rotation', 4],
      ['scale', 3]
    ]) {
      if (
        node[property].length !== size ||
        node[property].some(value => !Number.isFinite(value) || Math.abs(value) > 10000)
      ) {
        throw Error('Invalid node transform.');
      }
    }
    if (
      node.matrix &&
      (node.matrix.length !== 16 ||
        node.matrix.some(value => !Number.isFinite(value)))
    ) {
      throw Error('Invalid node matrix.');
    }
  }

  return nodes;
}

function readGLBClips(gltf, nodes, readAccessor) {
  return (gltf.animations || []).map(animation => {
    const tracks = animation.channels.map(channel => {
      const sampler = animation.samplers[channel.sampler];
      const property = {
        translation: 'translation',
        rotation: 'rotation',
        scale: 'scale'
      }[channel.target.path];
      if (!property || !nodes[channel.target.node]) {
        throw Error('Unsupported animation channel.');
      }
      if (nodes[channel.target.node].matrix) {
        throw Error('Animation on matrix-based nodes is unsupported.');
      }

      const interpolation = sampler.interpolation || 'LINEAR';
      if (!['LINEAR', 'STEP'].includes(interpolation)) {
        throw Error(
          'Cubic-spline clips are not supported in v0.1. Export linear keyframes first.'
        );
      }

      const times = readAccessor(sampler.input);
      const values = readAccessor(sampler.output);
      const size = property === 'rotation' ? 4 : 3;
      if (
        times.length > LIMITS.keys ||
        values.length !== times.length * size ||
        times.some((time, index) => time < 0 || (index && time <= times[index - 1]))
      ) {
        throw Error('Invalid animation samples.');
      }

      return {
        nodeId: nodes[channel.target.node].id,
        property,
        interpolation,
        keys: times.map((time, index) => ({
          time,
          value: values.slice(index * size, (index + 1) * size)
        }))
      };
    });

    if (
      tracks.length > LIMITS.tracks ||
      tracks.reduce((sum, track) => sum + track.keys.length, 0) > 10000
    ) {
      throw Error('Animation too complex.');
    }

    return {
      id: crypto.randomUUID(),
      name: (animation.name || 'Imported clip').slice(0, 120),
      duration: Math.max(
        0.1,
        ...tracks.flatMap(track => track.keys.map(key => key.time))
      ),
      loop: animation.extras?.recommendedLoop ?? true,
      tracks
    };
  });
}

export function importGLB(buffer) {
  if (buffer.byteLength > LIMITS.upload) {
    throw Error('Maximum file size is 50 MB.');
  }

  const {gltf, binary} = parseGLBChunks(buffer);
  if (gltf.skins?.length) {
    throw Error(
      'Skeletal/skinned models are not supported in v0.1. Use an unskinned, node-animated GLB.'
    );
  }
  if (gltf.textures?.length || gltf.images?.length) {
    throw Error(
      'Textured GLBs are not supported in v0.1. Export with solid materials.'
    );
  }
  if (gltf.extensionsRequired?.length) {
    throw Error(
      'Compressed or extension-dependent GLBs are not supported in v0.1.'
    );
  }
  if ((gltf.nodes || []).length > LIMITS.nodes) {
    throw Error('Maximum 160 scene nodes.');
  }
  if (gltf.buffers?.length !== 1 || gltf.buffers[0].uri) {
    throw Error('Only self-contained GLB files are supported.');
  }

  const readAccessor = readAccessorFactory(gltf, binary);
  const {meshes, meshMap} = readGLBMeshes(gltf, readAccessor);
  const nodes = readGLBNodes(gltf, meshMap);
  const clips = readGLBClips(gltf, nodes, readAccessor);
  const document = {
    name: gltf.scenes?.[gltf.scene || 0]?.name || 'Imported model',
    nodes,
    meshes,
    clips
  };

  worlds(document);
  return document;
}

function createAccessorWriter(chunks, bufferViews, accessors) {
  let offset = 0;

  function writeAccessor(values, type, componentType = 5126) {
    const typedArray =
      componentType === 5125
        ? new Uint32Array(values)
        : new Float32Array(values);
    const bytes = new Uint8Array(typedArray.buffer);
    bufferViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: bytes.byteLength
    });
    chunks.push(bytes);
    offset += bytes.length;

    const size = {SCALAR: 1, VEC3: 3, VEC4: 4}[type];
    const accessor = {
      bufferView: bufferViews.length - 1,
      componentType,
      count: values.length / size,
      type
    };
    if (type === 'VEC3') {
      accessor.min = [Infinity, Infinity, Infinity];
      accessor.max = [-Infinity, -Infinity, -Infinity];
      for (let index = 0; index < values.length; index++) {
        const component = index % 3;
        accessor.min[component] = Math.min(accessor.min[component], values[index]);
        accessor.max[component] = Math.max(accessor.max[component], values[index]);
      }
    }
    if (type === 'SCALAR') {
      let minimum = Infinity;
      let maximum = -Infinity;
      for (const value of values) {
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
      }
      accessor.min = [minimum];
      accessor.max = [maximum];
    }

    accessors.push(accessor);
    return accessors.length - 1;
  }

  return {writeAccessor, getOffset: () => offset};
}

function writeGLBBuffer(gltf, chunks, bufferLength) {
  const json = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const totalLength = 12 + 8 + jsonLength + 8 + bufferLength;
  const output = new ArrayBuffer(totalLength);
  const data = new DataView(output);
  const bytes = new Uint8Array(output);

  data.setUint32(0, 0x46546c67, true);
  data.setUint32(4, 2, true);
  data.setUint32(8, totalLength, true);
  data.setUint32(12, jsonLength, true);
  data.setUint32(16, 0x4e4f534a, true);
  bytes.fill(32, 20, 20 + jsonLength);
  bytes.set(json, 20);

  const binaryHeader = 20 + jsonLength;
  data.setUint32(binaryHeader, bufferLength, true);
  data.setUint32(binaryHeader + 4, 0x004e4942, true);

  let offset = binaryHeader + 8;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return output;
}

export function exportGLB(document, {animationId} = {}) {
  const chunks = [];
  const bufferViews = [];
  const accessors = [];
  const writer = createAccessorWriter(chunks, bufferViews, accessors);
  const gltf = {
    asset: {version: '2.0', generator: '3D Studio'},
    scene: 0,
    scenes: [{name: document.name, nodes: []}],
    nodes: [],
    meshes: [],
    materials: [],
    animations: []
  };
  const nodeIndex = new Map(
    document.nodes.map((node, index) => [node.id, index])
  );

  for (const mesh of document.meshes) {
    const attributes = {
      POSITION: writer.writeAccessor(mesh.positions, 'VEC3'),
      NORMAL: writer.writeAccessor(mesh.normals, 'VEC3')
    };
    if (mesh.colors) {
      attributes.COLOR_0 = writer.writeAccessor(mesh.colors, 'VEC3');
    }

    gltf.materials.push({
      pbrMetallicRoughness: {
        baseColorFactor: mesh.color || [1, 1, 1, 1],
        metallicFactor: 0,
        roughnessFactor: mesh.roughness ?? 0.8
      }
    });
    gltf.meshes.push({
      primitives: [
        {
          attributes,
          indices: writer.writeAccessor(mesh.indices, 'SCALAR', 5125),
          material: gltf.materials.length - 1
        }
      ]
    });
  }

  for (const [index, node] of document.nodes.entries()) {
    const outputNode = {
      name: node.name,
    };
    if (node.matrix) {
      outputNode.matrix = node.matrix;
    } else {
      Object.assign(outputNode, {
        translation: node.translation,
        rotation: node.rotation,
        scale: node.scale
      });
    }

    const children = document.nodes
      .filter(child => child.parent === node.id)
      .map(child => nodeIndex.get(child.id));
    if (node.meshes.length === 1) {
      outputNode.mesh = node.meshes[0];
    } else {
      for (const meshIndex of node.meshes) {
        children.push(document.nodes.length);
        document = {
          ...document,
          nodes: [
            ...document.nodes,
            {
              id: `__export-${index}-${meshIndex}`,
              name: `${node.name} primitive`,
              parent: node.id,
              translation: [0, 0, 0],
              rotation: [0, 0, 0, 1],
              scale: [1, 1, 1],
              meshes: [meshIndex]
            }
          ]
        };
      }
    }
    if (children.length) {
      outputNode.children = children;
    }
    if (!node.parent) {
      gltf.scenes[0].nodes.push(index);
    }
    gltf.nodes.push(outputNode);
  }

  // Multi-primitive imports are flattened to one mesh per node by the app before export.
  if (gltf.nodes.length !== document.nodes.length) {
    throw Error('Export of multi-primitive nodes is not yet supported.');
  }

  const clips =
    animationId === undefined || animationId === '__all__'
      ? document.clips
      : document.clips.filter(clip => clip.id === animationId);

  for (const clip of clips) {
    if (!clip.tracks.some(track => track.keys.length)) {
      continue;
    }

    const animation = {
      name: clip.name,
      samplers: [],
      channels: [],
      extras: {recommendedLoop: clip.loop}
    };
    for (const track of clip.tracks) {
      if (!nodeIndex.has(track.nodeId) || !track.keys.length) {
        continue;
      }

      const samplerIndex = animation.samplers.length;
      animation.samplers.push({
        input: writer.writeAccessor(
          track.keys.map(key => key.time),
          'SCALAR'
        ),
        output: writer.writeAccessor(
          track.keys.flatMap(key => key.value),
          track.property === 'rotation' ? 'VEC4' : 'VEC3'
        ),
        interpolation: track.interpolation
      });
      animation.channels.push({
        sampler: samplerIndex,
        target: {
          node: nodeIndex.get(track.nodeId),
          path: track.property
        }
      });
    }
    gltf.animations.push(animation);
  }

  gltf.bufferViews = bufferViews;
  gltf.accessors = accessors;
  gltf.buffers = [{byteLength: writer.getOffset()}];
  return writeGLBBuffer(gltf, chunks, writer.getOffset());
}

const VERTEX_SHADER = `#version 300 es
in vec3 position;
in vec3 normal;
in vec3 pigment;
uniform mat4 model;
uniform mat4 camera;
uniform mat3 normalMat;
out vec3 N;
out vec3 C;
out vec3 W;
void main() {
  vec4 w = model * vec4(position, 1.);
  gl_Position = camera * w;
  W = w.xyz;
  N = normalMat * normal;
  C = pigment;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec3 N;
in vec3 C;
in vec3 W;
uniform vec3 color;
uniform vec3 eye;
uniform float roughness;
uniform float selected;
out vec4 outColor;
void main() {
  vec3 n = normalize(N);
  vec3 l = normalize(vec3(-.6, 1., 1.2));
  vec3 v = normalize(eye - W);
  float diff = max(dot(n, l), 0.);
  float fill = max(dot(n, normalize(vec3(1., .3, .4))), 0.);
  float spec = pow(
    max(dot(n, normalize(l + v)), 0.),
    mix(140., 12., roughness)
  ) * (1. - roughness) * .65;
  vec3 lit = color * C * (.52 + .4 * diff + .14 * fill);
  lit += spec * vec3(1., .95, .9);
  lit += selected * .06 * vec3(.4, .2, .6);
  outColor = vec4(pow(max(lit, vec3(0.)), vec3(1. / 2.2)), 1.);
}`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: true
    });
    if (!this.gl) {
      throw Error('WebGL2 is required. Try a current desktop browser.');
    }

    const {gl} = this;
    const shader = (type, source) => {
      const shaderObject = gl.createShader(type);
      gl.shaderSource(shaderObject, source);
      gl.compileShader(shaderObject);
      if (!gl.getShaderParameter(shaderObject, gl.COMPILE_STATUS)) {
        throw Error(gl.getShaderInfoLog(shaderObject));
      }
      return shaderObject;
    };

    this.program = gl.createProgram();
    gl.attachShader(this.program, shader(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(
      this.program,
      shader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    );
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw Error(gl.getProgramInfoLog(this.program));
    }

    this.uniforms = {};
    for (const name of [
      'model',
      'camera',
      'normalMat',
      'color',
      'roughness',
      'selected',
      'eye'
    ]) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }
    this.attributes = ['position', 'normal', 'pigment'].map(name =>
      gl.getAttribLocation(this.program, name)
    );
    this.yaw = -0.18;
    this.pitch = 0.05;
    this.distance = 4;
    this.target = [0, 1, 0];
    this.gpu = [];

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    canvas.onpointerdown = event => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    canvas.onpointerup = () => {
      dragging = false;
    };
    canvas.onpointermove = event => {
      if (!dragging) {
        return;
      }
      this.yaw -= (event.clientX - lastX) * 0.008;
      this.pitch = Math.max(
        -1.2,
        Math.min(1.2, this.pitch + (event.clientY - lastY) * 0.006)
      );
      lastX = event.clientX;
      lastY = event.clientY;
    };
    canvas.onwheel = event => {
      event.preventDefault();
      this.distance = Math.max(
        0.2,
        Math.min(200, this.distance * Math.exp(event.deltaY * 0.001))
      );
    };
    canvas.onkeydown = event => {
      if (event.key === 'ArrowLeft') {
        this.yaw -= 0.1;
      } else if (event.key === 'ArrowRight') {
        this.yaw += 0.1;
      } else if (event.key === 'ArrowUp') {
        this.pitch = Math.min(1.2, this.pitch + 0.1);
      } else if (event.key === 'ArrowDown') {
        this.pitch = Math.max(-1.2, this.pitch - 0.1);
      } else {
        return;
      }
      event.preventDefault();
    };
  }

  setDocument(document) {
    const {gl} = this;
    for (const mesh of this.gpu) {
      for (const buffer of mesh.buffers) {
        gl.deleteBuffer(buffer);
      }
    }

    this.doc = document;
    this.gpu = document.meshes.map(mesh => {
      const buffers = [];
      const createBuffer = (target, data) => {
        const buffer = gl.createBuffer();
        buffers.push(buffer);
        gl.bindBuffer(target, buffer);
        gl.bufferData(target, data, gl.STATIC_DRAW);
        return buffer;
      };

      return {
        vertex: createBuffer(
          gl.ARRAY_BUFFER,
          new Float32Array(mesh.positions)
        ),
        normal: createBuffer(gl.ARRAY_BUFFER, new Float32Array(mesh.normals)),
        color: createBuffer(
          gl.ARRAY_BUFFER,
          new Float32Array(
            mesh.colors || Array(mesh.positions.length).fill(1)
          )
        ),
        index: createBuffer(
          gl.ELEMENT_ARRAY_BUFFER,
          new Uint32Array(mesh.indices)
        ),
        count: mesh.indices.length,
        buffers
      };
    });
    this.fit();
  }

  fit() {
    if (!this.doc) {
      return;
    }

    const worldMatrices = worlds(this.doc);
    const minimum = [Infinity, Infinity, Infinity];
    const maximum = [-Infinity, -Infinity, -Infinity];

    for (const node of this.doc.nodes) {
      for (const meshIndex of node.meshes) {
        const positions = this.doc.meshes[meshIndex].positions;
        for (let index = 0; index < positions.length; index += 3) {
          const position = point(
            worldMatrices.get(node.id),
            positions.slice(index, index + 3)
          );
          position.forEach((value, component) => {
            minimum[component] = Math.min(minimum[component], value);
            maximum[component] = Math.max(maximum[component], value);
          });
        }
      }
    }

    if (!Number.isFinite(minimum[0])) {
      return;
    }

    this.target = minimum.map(
      (value, component) => (value + maximum[component]) / 2
    );
    this.distance = Math.max(
      0.5,
      Math.hypot(...maximum.map((value, component) => value - minimum[component])) *
        1.45
    );
    this.yaw = -0.18;
    this.pitch = 0.06;
  }

  render(poseMap, selected) {
    if (!this.doc) {
      return;
    }

    const {gl} = this;
    const rect = this.canvas.getBoundingClientRect();
    const devicePixelRatio = Math.min(globalThis.devicePixelRatio, 1.5);
    const width = Math.max(1, Math.round(rect.width * devicePixelRatio));
    const height = Math.max(1, Math.round(rect.height * devicePixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.program);

    const eye = [
      this.target[0] +
        Math.sin(this.yaw) * Math.cos(this.pitch) * this.distance,
      this.target[1] + Math.sin(this.pitch) * this.distance,
      this.target[2] +
        Math.cos(this.yaw) * Math.cos(this.pitch) * this.distance
    ];
    const z = normalize(eye.map((value, index) => value - this.target[index]));
    const x = normalize(cross([0, 1, 0], z));
    const y = cross(z, x);
    const view = [
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1
    ];
    const fieldOfView = 1 / Math.tan(0.35);
    const near = 0.01;
    const far = 1000;
    const projection = [
      fieldOfView / (width / height), 0, 0, 0,
      0, fieldOfView, 0, 0,
      0, 0, (far + near) / (near - far), -1,
      0, 0, (2 * far * near) / (near - far), 0
    ];

    gl.uniformMatrix4fv(
      this.uniforms.camera,
      false,
      multiply(projection, view)
    );
    gl.uniform3fv(this.uniforms.eye, eye);

    const worldMatrices = worlds(this.doc, poseMap);
    for (const node of this.doc.nodes) {
      for (const meshIndex of node.meshes) {
        const gpuMesh = this.gpu[meshIndex];
        const mesh = this.doc.meshes[meshIndex];
        const world = worldMatrices.get(node.id);
        for (const [index, buffer] of [
          gpuMesh.vertex,
          gpuMesh.normal,
          gpuMesh.color
        ].entries()) {
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          gl.enableVertexAttribArray(this.attributes[index]);
          gl.vertexAttribPointer(
            this.attributes[index],
            3,
            gl.FLOAT,
            false,
            0,
            0
          );
        }

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpuMesh.index);
        gl.uniformMatrix4fv(this.uniforms.model, false, world);
        gl.uniformMatrix3fv(
          this.uniforms.normalMat,
          false,
          normalMatrix(world)
        );
        gl.uniform3fv(
          this.uniforms.color,
          (mesh.color || [0.5, 0.3, 0.8, 1]).slice(0, 3)
        );
        gl.uniform1f(this.uniforms.roughness, mesh.roughness ?? 0.8);
        gl.uniform1f(
          this.uniforms.selected,
          node.id === selected || node.parent === selected ? 1 : 0
        );
        gl.drawElements(
          gl.TRIANGLES,
          gpuMesh.count,
          gl.UNSIGNED_INT,
          0
        );
      }
    }
  }
}
