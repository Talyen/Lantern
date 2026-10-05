import * as THREE from 'three';
import { cameraOffset,desktopViewHeight } from '../../src/session/projection.ts';
import { defaultCameraZoom } from '../../src/rendering/graphics-settings.ts';
import { cli, parseArgs } from '../lib/cli.mjs';
await cli(async()=>{
const args=parseArgs(process.argv.slice(2));if(args['--help']){console.log('Usage: npm run levels:calibrate (prints a new reference envelope; does not resize areas)');return;}
const width=1920,height=1080;
const camera=new THREE.OrthographicCamera(-desktopViewHeight*width/height/2,desktopViewHeight*width/height/2,desktopViewHeight/2,-desktopViewHeight/2,.1,100);
camera.zoom=defaultCameraZoom;camera.position.set(...cameraOffset);camera.lookAt(0,0,0);camera.updateProjectionMatrix();camera.updateMatrixWorld();
const ray=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>{ray.setFromCamera(new THREE.Vector2(x,y),camera);const point=ray.ray.intersectPlane(plane,new THREE.Vector3());if(!point)throw new Error('Camera does not intersect the ground');return point;});
const screen=[corners[0].distanceTo(corners[1]),corners[1].distanceTo(corners[2])],right=corners[1].clone().sub(corners[0]).normalize();
console.log(JSON.stringify({width:screen[0]*2,depth:screen[1]*2,apron:4,yaw:Math.atan2(-right.z,right.x),reference:{width,height,zoom:defaultCameraZoom},screen},null,2));

});
