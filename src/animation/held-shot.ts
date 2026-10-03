import * as THREE from 'three';
/** Extend the full draw, keeping the release contact and recovery explicitly authored. */
export function heldShot(source: THREE.AnimationClip, draw: number, contact: number, release: number, duration: number): THREE.AnimationClip {
  const times=Array.from({length:Math.ceil(duration*60)+1},(_,i)=>i/Math.ceil(duration*60)*duration);
  const holdEnd=release-(contact-draw);
  const sourceTime=(time:number)=>time<draw ? time : time<holdEnd ? draw : time<release ? draw+(time-holdEnd) : contact+(time-release)/(duration-release)*(source.duration-contact);
  const tracks=source.tracks.map(track=> {
    const interpolant=track.InterpolantFactoryMethodLinear();
    const values=times.flatMap(time=>Array.from(interpolant.evaluate(sourceTime(time))));
    return track instanceof THREE.QuaternionKeyframeTrack ? new THREE.QuaternionKeyframeTrack(track.name,times,values) : new THREE.VectorKeyframeTrack(track.name,times,values);
  });
  return new THREE.AnimationClip('deadeye',duration,tracks);
}
