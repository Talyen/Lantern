import { PropertyBinding, type AnimationClip, type AnimationObjectGroup, type Object3D } from 'three';

/** Validate each distinct track and node once per rig installation. No persistent rig cache. */
export function unmatchedMotionNode(root: Object3D | AnimationObjectGroup, clips: Iterable<AnimationClip>): string | undefined {
  const tracks = new Set<string>(), nodes = new Set<string>();
  for (const clip of clips) for (const track of clip.tracks) {
    if (tracks.has(track.name)) continue;
    tracks.add(track.name);
    const { nodeName } = PropertyBinding.parseTrackName(track.name);
    if (nodes.has(nodeName)) continue;
    if (!PropertyBinding.findNode(root, nodeName)) return nodeName;
    nodes.add(nodeName);
  }
}
