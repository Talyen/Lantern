import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { disposeSceneInstances } from '../assets/resource-ownership';
import { arrowRainSequence } from '../gameplay/arrow-rain-sequence';

const point = (bone: THREE.Object3D) => bone.getWorldPosition(new THREE.Vector3());
const rotation = (bone: THREE.Object3D) => bone.getWorldQuaternion(new THREE.Quaternion());
function worldRotation(bone: THREE.Object3D, quaternion: THREE.Quaternion): void {
  bone.quaternion.copy(rotation(bone.parent!).invert().multiply(quaternion));
  bone.updateMatrixWorld(true);
}

/** Aim a sampled arm without stretching its bones; retain the source elbow's bend side. */
function aimArm(upper: THREE.Object3D, lower: THREE.Object3D, hand: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3, wrist: THREE.Quaternion): void {
  const shoulder = point(upper), elbow = point(lower), end = point(hand);
  const a = shoulder.distanceTo(elbow), b = elbow.distanceTo(end);
  const axis = target.clone().sub(shoulder), distance = THREE.MathUtils.clamp(axis.length(), Math.abs(a - b) + .0001, a + b - .0001);
  axis.normalize();
  const bend = pole.clone().sub(shoulder); bend.addScaledVector(axis, -bend.dot(axis)).normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  const desiredElbow = shoulder.clone().addScaledVector(axis, along).addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along)));
  const desiredHand = shoulder.clone().addScaledVector(axis, distance);
  worldRotation(upper, new THREE.Quaternion().setFromUnitVectors(elbow.sub(shoulder).normalize(), desiredElbow.clone().sub(shoulder).normalize()).multiply(rotation(upper)));
  worldRotation(lower, new THREE.Quaternion().setFromUnitVectors(point(hand).sub(point(lower)).normalize(), desiredHand.sub(point(lower)).normalize()).multiply(rotation(lower)));
  worldRotation(hand, wrist);
}

/** The authored skyward variant: raise, hold, release and lower the compatible Mixamo shot. */
export function skywardShot(source: THREE.Object3D, shot: THREE.AnimationClip, drawDuration: number, contact: number): THREE.AnimationClip {
  const rig = clone(source);
  rig.traverse(object=>{if (object instanceof THREE.SkinnedMesh) object.skeleton.pose();});
  const names = ['Shoulder_L', 'Elbow_L', 'Hand_L', 'Shoulder_R', 'Elbow_R', 'Hand_R', 'Neck', 'Head'];
  const bones = names.map(name => { const bone = rig.getObjectByName(name); if (!bone) throw new Error(`Skyward shot requires ${name}.`); return bone; });
  const tracks = shot.tracks.map(track => ({ track, interpolant: track.InterpolantFactoryMethodLinear(), values: [] as number[] }));
  const authored = new Map(names.map(name => [name, [] as number[]]));
  const sequence = arrowRainSequence, times: number[] = [];
  const hold = sequence.release - contact - drawDuration;
  const samples = Math.ceil(sequence.motion * 60);
  try {
    for (let frame = 0; frame <= samples; frame++) {
      const time = frame / samples * sequence.motion;
      const sourceTime = Math.min(shot.duration, time < drawDuration ? time : time < drawDuration + hold ? drawDuration : time - hold);
      // Each sampled aim starts from the unmodified source keys.
      for (const { track, interpolant } of tracks) {
        const split = track.name.lastIndexOf('.'), bone = rig.getObjectByName(track.name.slice(0, split));
        if (!bone) continue;
        const value = interpolant.evaluate(sourceTime);
        if (track.name.endsWith('.quaternion')) bone.quaternion.fromArray(value);
        else if (track.name.endsWith('.position')) bone.position.fromArray(value);
        else if (track.name.endsWith('.scale')) bone.scale.fromArray(value);
      }
      rig.updateMatrixWorld(true);
      const weight = THREE.MathUtils.smoothstep(time, .08, .56) * (1 - THREE.MathUtils.smoothstep(time, sequence.release + .15, sequence.motion));
      const aim = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -THREE.MathUtils.degToRad(58) * weight);
      const pivot = point(bones[0]).add(point(bones[3])).multiplyScalar(.5);
      const armPoses = [0, 3].map(index => ({ index, target: point(bones[index + 2]).sub(pivot).applyQuaternion(aim).add(pivot), pole: point(bones[index + 1]).sub(pivot).applyQuaternion(aim).add(pivot), wrist: aim.clone().multiply(rotation(bones[index + 2])) }));
      for (const { index, target, pole, wrist } of armPoses) aimArm(bones[index], bones[index + 1], bones[index + 2], target, pole, wrist);
      const look = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -THREE.MathUtils.degToRad(14) * weight);
      for (const bone of bones.slice(6)) worldRotation(bone, look.clone().multiply(rotation(bone)));
      times.push(time);
      for (const bone of bones) {
        const values = authored.get(bone.name)!;
        bone.quaternion.toArray(values, values.length);
      }
      for (const record of tracks) record.values.push(...record.interpolant.evaluate(sourceTime));
    }
    const output = tracks.filter(({ track }) => !names.some(name => track.name === `${name}.quaternion`)).map(({ track, values }) => {
      const copy = track.clone(); copy.times = new Float32Array(times); copy.values = new Float32Array(values); return copy;
    });
    for (const [name, values] of authored) output.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values));
    return new THREE.AnimationClip('arrow-rain-skyward', sequence.motion, output);
  } finally {
    disposeSceneInstances(rig, { skeletons: true });
  }
}
