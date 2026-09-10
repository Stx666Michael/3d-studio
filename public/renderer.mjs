import * as THREE from 'three';

const MAX_PIXEL_RATIO = 1.5;
const SELECTION_COLOR = new THREE.Color(0x663399);

function createGeometry(mesh) {
  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(mesh.positions), 3)
  );
  geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(new Float32Array(mesh.normals), 3)
  );
  if (mesh.colors) {
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(mesh.colors), 3)
    );
  }
  geometry.setIndex(
    new THREE.BufferAttribute(new Uint32Array(mesh.indices), 1)
  );
  geometry.computeBoundingSphere();

  return geometry;
}

function createMaterial(mesh) {
  const color = mesh.color || [0.5, 0.3, 0.8, 1];
  const materialColor = new THREE.Color().setRGB(
    color[0],
    color[1],
    color[2],
    THREE.LinearSRGBColorSpace
  );

  return new THREE.MeshStandardMaterial({
    color: materialColor,
    roughness: mesh.roughness ?? 0.8,
    metalness: 0,
    vertexColors: Boolean(mesh.colors),
    emissive: SELECTION_COLOR,
    emissiveIntensity: 0
  });
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(
      Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO)
    );

    this.scene = new THREE.Scene();
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.nodeObjects = new Map();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6f4a8a, 1.8));

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(-0.6, 1, 1.2);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffb7d6, 0.8);
    fillLight.position.set(1, 0.3, 0.4);
    this.scene.add(fillLight);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    this.yaw = -0.18;
    this.pitch = 0.05;
    this.targetYaw = this.yaw;
    this.targetPitch = this.pitch;
    this.distance = 4;
    this.target = new THREE.Vector3(0, 1, 0);
    this.gpu = [];

    this.bindControls();
  }

  bindControls() {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    this.canvas.onpointerdown = event => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      this.canvas.setPointerCapture(event.pointerId);
    };
    this.canvas.onpointerup = () => {
      dragging = false;
    };
    this.canvas.onpointercancel = () => {
      dragging = false;
    };
    this.canvas.onpointermove = event => {
      if (!dragging) {
        return;
      }

      this.targetYaw -= (event.clientX - lastX) * 0.008;
      this.targetPitch = Math.max(
        -1.2,
        Math.min(1.2, this.targetPitch + (event.clientY - lastY) * 0.006)
      );
      lastX = event.clientX;
      lastY = event.clientY;
    };
    this.canvas.onwheel = event => {
      event.preventDefault();
      this.distance = Math.max(
        0.2,
        Math.min(200, this.distance * Math.exp(event.deltaY * 0.001))
      );
    };
    this.canvas.onkeydown = event => {
      if (event.key === 'ArrowLeft') {
        this.targetYaw -= 0.1;
      } else if (event.key === 'ArrowRight') {
        this.targetYaw += 0.1;
      } else if (event.key === 'ArrowUp') {
        this.targetPitch = Math.min(1.2, this.targetPitch + 0.1);
      } else if (event.key === 'ArrowDown') {
        this.targetPitch = Math.max(-1.2, this.targetPitch - 0.1);
      } else {
        return;
      }
      event.preventDefault();
    };
  }

  disposeScene() {
    this.root.traverse(object => {
      if (!object.isMesh) {
        return;
      }

      object.geometry.dispose();
      object.material.dispose();
    });
    this.root.clear();
    this.nodeObjects.clear();
    this.gpu = [];
  }

  setDocument(document) {
    this.disposeScene();
    this.doc = document;
    const geometries = document.meshes.map(createGeometry);

    for (const node of document.nodes) {
      const object = new THREE.Object3D();
      object.name = node.name;
      object.userData.nodeId = node.id;

      if (node.matrix) {
        object.matrixAutoUpdate = false;
        object.matrix.fromArray(node.matrix);
        object.matrixWorldNeedsUpdate = true;
      } else {
        object.position.fromArray(node.translation);
        object.quaternion.fromArray(node.rotation);
        object.scale.fromArray(node.scale);
      }

      this.nodeObjects.set(node.id, object);
    }

    for (const node of document.nodes) {
      const object = this.nodeObjects.get(node.id);
      const parent = node.parent
        ? this.nodeObjects.get(node.parent)
        : this.root;
      if (!parent) {
        throw Error('Missing parent node.');
      }
      parent.add(object);

      for (const meshIndex of node.meshes) {
        const mesh = new THREE.Mesh(
          geometries[meshIndex],
          createMaterial(document.meshes[meshIndex])
        );
        mesh.userData.nodeId = node.id;
        object.add(mesh);
      }
    }

    this.gpu = geometries;
    this.fit();
  }

  updateCamera(force = false) {
    if (force) {
      this.yaw = this.targetYaw;
      this.pitch = this.targetPitch;
    } else {
      this.yaw += (this.targetYaw - this.yaw) * 0.18;
      this.pitch += (this.targetPitch - this.pitch) * 0.18;
    }

    const eye = new THREE.Vector3(
      this.target.x +
        Math.sin(this.yaw) * Math.cos(this.pitch) * this.distance,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z +
        Math.cos(this.yaw) * Math.cos(this.pitch) * this.distance
    );
    this.camera.position.copy(eye);
    this.camera.lookAt(this.target);
  }

  fit() {
    if (!this.doc) {
      return;
    }

    this.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.root);
    if (bounds.isEmpty()) {
      return;
    }

    bounds.getCenter(this.target);
    const size = bounds.getSize(new THREE.Vector3());
    this.distance = Math.max(0.5, size.length() * 1.45);
    this.targetYaw = -0.18;
    this.targetPitch = 0.06;
    this.updateCamera(true);
  }

  updatePoses(poseMap) {
    for (const node of this.doc.nodes) {
      if (node.matrix) {
        continue;
      }

      const object = this.nodeObjects.get(node.id);
      const pose = poseMap?.get(node.id) || node;
      object.position.fromArray(pose.translation);
      object.quaternion.fromArray(pose.rotation);
      object.scale.fromArray(pose.scale);
    }
  }

  updateSelection(selected) {
    const selectedNodes = new Set(
      this.doc.nodes
        .filter(node => node.id === selected || node.parent === selected)
        .map(node => node.id)
    );

    this.root.traverse(object => {
      if (!object.isMesh) {
        return;
      }

      object.material.emissiveIntensity = selectedNodes.has(
        object.userData.nodeId
      )
        ? 0.18
        : 0;
    });
  }

  render(poseMap, selected) {
    if (!this.doc) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const pixelRatio = Math.min(
      globalThis.devicePixelRatio || 1,
      MAX_PIXEL_RATIO
    );
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const drawingWidth = Math.round(width * pixelRatio);
    const drawingHeight = Math.round(height * pixelRatio);
    if (
      this.canvas.width !== drawingWidth ||
      this.canvas.height !== drawingHeight
    ) {
      this.renderer.setPixelRatio(pixelRatio);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }

    this.updatePoses(poseMap);
    this.updateSelection(selected);
    this.root.updateMatrixWorld(true);
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
  }
}
