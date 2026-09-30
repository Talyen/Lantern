import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';

const mount = document.querySelector<HTMLDivElement>('#scene')!;
const status = document.querySelector<HTMLParagraphElement>('#asset-status')!;
const rockToggle = document.querySelector<HTMLButtonElement>('#rock-toggle')!;
const rockFocus = document.querySelector<HTMLButtonElement>('#rock-focus')!;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#213839');
scene.fog = new THREE.Fog('#213839', 22, 45);

const camera = new THREE.OrthographicCamera(-9, 9, 6, -6, 0.1, 100);
camera.position.set(13, 13, 13);
camera.lookAt(0, 1, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(mount.clientWidth, mount.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.65;
mount.append(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minZoom = 0.75;
controls.maxZoom = 2.2;
controls.minPolarAngle = Math.PI / 4.5;
controls.maxPolarAngle = Math.PI / 2.45;
controls.update();

scene.add(new THREE.HemisphereLight('#dbe7dd', '#4b5846', 2.1));
const sun = new THREE.DirectionalLight('#ffe5b7', 3.1);
sun.position.set(-7, 13, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -13;
sun.shadow.camera.right = 13;
sun.shadow.camera.top = 13;
sun.shadow.camera.bottom = -13;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const material = (color: string, roughness = 1) => new THREE.MeshStandardMaterial({ color, roughness });
const ground = new THREE.Mesh(new THREE.CylinderGeometry(8.1, 8.4, 0.55, 72), material('#485c48'));
ground.position.y = -0.32;
ground.receiveShadow = true;
scene.add(ground);
const rim = new THREE.Mesh(new THREE.CylinderGeometry(8.4, 8.3, 0.5, 72), material('#303b38'));
rim.position.y = -0.47;
rim.receiveShadow = true;
scene.add(rim);

// Procedural ground details support the small local Synty composition.
const pebbleGeometry = new THREE.DodecahedronGeometry(0.16, 0);
const pebbleMaterial = material('#8b9680');
for (let i = 0; i < 68; i++) {
  const angle = i * 2.39996;
  const radius = 1.3 + Math.sqrt(i / 68) * 6.1;
  const pebble = new THREE.Mesh(pebbleGeometry, pebbleMaterial);
  pebble.position.set(Math.cos(angle) * radius, 0.04, Math.sin(angle) * radius);
  pebble.scale.setScalar(0.5 + (i % 5) * 0.16);
  pebble.rotation.y = angle;
  pebble.castShadow = true;
  scene.add(pebble);
}

type Kind = 'pine' | 'rock' | 'chest';
type Placement = { x: number; z: number; rotation?: number; height: number };
const layouts: Record<Kind, Placement[]> = {
  pine: [
    { x: -3.2, z: -1.3, height: 5.4 },
    { x: 3.5, z: -2.2, height: 4.3, rotation: 0.8 },
    { x: -4.6, z: 2.7, height: 3.4, rotation: 1.6 },
  ],
  rock: [
    { x: 3.1, z: 2.3, height: 1.35, rotation: 0.4 },
    { x: -1.8, z: 3.6, height: 0.95, rotation: 1.8 },
  ],
  chest: [{ x: 0.55, z: 0.25, height: 1.05, rotation: -0.65 }],
};

function placeModel(source: THREE.Group, placement: Placement): THREE.Group {
  const model = source.clone(true);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  if (size.y <= 0) throw new Error('Model has no visible height');
  model.scale.multiplyScalar(placement.height / size.y);
  model.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(model);
  const center = fitted.getCenter(new THREE.Vector3());
  model.position.set(placement.x - center.x, -fitted.min.y, placement.z - center.z);
  model.rotation.y += placement.rotation ?? 0;
  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  scene.add(model);
  return model;
}

window.addEventListener('resize', resize);
resize();
tick();

const loader = new GLTFLoader();
const kinds = ['pine', 'rock', 'chest'] as const;
const originalRocks: THREE.Group[] = [];
const paintedRocks: THREE.Group[] = [];
let loadedCount = 0;
await Promise.all(kinds.map(async (kind) => {
  try {
    const gltf = await loader.loadAsync(`/vendor/synty/${kind}.glb`);
    const placements = layouts[kind];
    for (const placement of placements) {
      const placed = placeModel(gltf.scene, placement);
      if (kind === 'rock') originalRocks.push(placed);
    }
    loadedCount++;
  } catch {
    // Missing private art is reported in the scene card below.
  }
}));
status.textContent = loadedCount === 3
  ? 'Synty models loaded from your local Topaz library.'
  : loadedCount === 0
    ? 'No local Synty art found. Run the importer, then refresh.'
    : `${loadedCount} of 3 Synty models loaded. Re-run the importer to restore the missing art.`;

if (originalRocks.length > 0) {
  rockFocus.disabled = false;
  const homePosition = camera.position.clone();
  const homeTarget = controls.target.clone();
  let focused = false;
  rockFocus.addEventListener('click', () => {
    focused = !focused;
    if (focused) {
      const target = new THREE.Vector3(layouts.rock[0].x, 0.7, layouts.rock[0].z);
      camera.position.add(target.clone().sub(controls.target));
      controls.target.copy(target);
      camera.zoom = 2.2;
    } else {
      camera.position.copy(homePosition);
      controls.target.copy(homeTarget);
      camera.zoom = 1;
    }
    camera.updateProjectionMatrix();
    controls.update();
    rockFocus.textContent = focused ? 'Return to clearing' : 'Inspect rock up close';
  });
  try {
    const painted = await loader.loadAsync('/vendor/synty/rock-painted.glb');
    for (const placement of layouts.rock) paintedRocks.push(placeModel(painted.scene, placement));
    originalRocks.forEach((rock) => { rock.visible = false; });
    let showPainted = true;
    rockToggle.disabled = false;
    rockToggle.setAttribute('aria-pressed', 'true');
    rockToggle.textContent = 'Show original Synty surface';
    rockToggle.addEventListener('click', () => {
      showPainted = !showPainted;
      originalRocks.forEach((rock) => { rock.visible = !showPainted; });
      paintedRocks.forEach((rock) => { rock.visible = showPainted; });
      rockToggle.setAttribute('aria-pressed', String(showPainted));
      rockToggle.textContent = showPainted ? 'Show original Synty surface' : 'Show ImageGen painted surface';
    });
  } catch {
    rockToggle.textContent = 'Run importer for painted rock';
  }
}

function resize(): void {
  const width = mount.clientWidth;
  const height = mount.clientHeight;
  const aspect = width / height;
  const viewHeight = window.innerWidth < 720 ? 16 : 13.5;
  camera.left = -viewHeight * aspect / 2;
  camera.right = viewHeight * aspect / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
function tick(): void {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
