import { cameraOffset as offset, desktopViewHeight } from './projection';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { defaultCameraZoom } from '../rendering/graphics-settings';

export function createCamera(canvas: HTMLCanvasElement) {
  const camera = new THREE.OrthographicCamera(-9, 9, 6, -6, 0.1, 100);
  // Projection owns the fixed pitch and azimuth; follow only translates this view.
  const cameraOffset = new THREE.Vector3(...offset);
  camera.position.copy(cameraOffset);
  const controls = new OrbitControls(camera, canvas);
  controls.enableRotate = false; controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = false;
  controls.minZoom = 0.9;
  controls.maxZoom = 2;
  camera.zoom = defaultCameraZoom;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0.9, 0);
  camera.position.copy(controls.target).add(cameraOffset);
  controls.update();
  // World-space tuning: absorb small ground changes, then reveal a little space ahead.
  const followDeadZone = .15, followRate = 8, lookAheadSeconds = .20, maxLead = .65;
  const anchor = controls.target.clone(), lead = new THREE.Vector3();
  const previous = new THREE.Vector3(), desiredLead = new THREE.Vector3();
  let sampled = false;
  function resetFollow(position: THREE.Vector3): void {
    anchor.copy(position); anchor.y += .9; lead.set(0, 0, 0);
    previous.copy(position); sampled = false;
    controls.target.copy(anchor); camera.position.copy(anchor).add(cameraOffset);
    controls.update(); camera.updateMatrixWorld();
  }
  return { camera, controls, resetFollow,
    zoom(direction: number) { camera.zoom=THREE.MathUtils.clamp(camera.zoom*Math.exp(direction*.09),controls.minZoom,controls.maxZoom); camera.updateProjectionMatrix(); },
    suspendFollow() { sampled = false; },
    follow(position: THREE.Vector3, dt: number) {
      if (dt <= 0) return;
      const ease = 1 - Math.exp(-dt * followRate);
      const dx = position.x - anchor.x, dz = position.z - anchor.z;
      const distance = Math.hypot(dx, dz);
      if (distance > followDeadZone) {
        const correction = (distance - followDeadZone) / distance * ease;
        anchor.x += dx * correction; anchor.z += dz * correction;
      }
      anchor.y += (position.y + .9 - anchor.y) * ease;
      desiredLead.set(0, 0, 0);
      if (sampled && distance > followDeadZone) {
        desiredLead.set(position.x - previous.x, 0, position.z - previous.z).multiplyScalar(lookAheadSeconds / dt);
        desiredLead.clampLength(0, maxLead);
      }
      lead.lerp(desiredLead, ease);
      previous.copy(position); sampled = true;
      controls.target.copy(anchor).add(lead);
      // Only translate the fixed view; pointer facing never changes framing.
      camera.position.copy(controls.target).add(cameraOffset);
    },
    inspect(active: boolean, rock: { x: number; z: number }) {
      if (active) { controls.target.set(rock.x, 0.7, rock.z); camera.position.copy(controls.target).add(cameraOffset); camera.zoom = 2; }
      else camera.zoom = defaultCameraZoom;
      camera.updateProjectionMatrix(); controls.update();
    },
    resize(width: number, height: number) {
      const aspect = width / height; const viewHeight = window.innerWidth < 720 ? 15 : desktopViewHeight;
      camera.left = -viewHeight * aspect / 2; camera.right = viewHeight * aspect / 2;
      camera.top = viewHeight / 2; camera.bottom = -viewHeight / 2; camera.updateProjectionMatrix();
    },
  };
}
