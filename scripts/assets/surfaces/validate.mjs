import { isDeepStrictEqual } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { validateMaterial } from '../../../src/assets/material-validation.ts';
import { cli,isMain,parseArgs,root } from '../../lib/cli.mjs';
const components={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array};
const widths={SCALAR:1,VEC2:2,VEC3:3,VEC4:4};
export async function validateGlb(path) {
  const file=await readFile(path);if(file.readUInt32LE(0)!==0x46546c67)throw Error('Invalid GLB header');const length=file.readUInt32LE(12),data=JSON.parse(file.subarray(20,20+length)),bin=file.subarray(28+length);
  const accessor=index=>{const a=data.accessors[index],v=data.bufferViews[a.bufferView],Type=components[a.componentType],width=widths[a.type];if(!Type||!width||a.sparse)throw Error('Unsupported material-validation accessor');const values=new Type(a.count*width),stride=v.byteStride??width*Type.BYTES_PER_ELEMENT,offset=(v.byteOffset??0)+(a.byteOffset??0);for(let i=0;i<a.count;i++)for(let c=0;c<width;c++){const start=offset+i*stride+c*Type.BYTES_PER_ELEMENT;values[i*width+c]=new Type(Uint8Array.from(bin.subarray(start,start+Type.BYTES_PER_ELEMENT)).buffer)[0];}return new THREE.BufferAttribute(values,width,a.normalized??false);};
  const failures=[],recipes=JSON.parse(await readFile(resolve(root,'assets/material-recipes.json')));
  for(const mesh of data.meshes??[])for(const primitive of mesh.primitives){
    const g=new THREE.BufferGeometry();for(const [key,value] of Object.entries(primitive.attributes)){const name={POSITION:'position',NORMAL:'normal',TANGENT:'tangent',TEXCOORD_0:'uv'}[key]??(key.startsWith('TEXCOORD_')?'uv'+key.slice(9):undefined);if(name)g.setAttribute(name,accessor(value));}if(primitive.indices!==undefined)g.setIndex(accessor(primitive.indices));
    const spec=data.materials[primitive.material??0]??{},m=new THREE.MeshStandardMaterial({name:spec.name});
    const roles={map:spec.pbrMetallicRoughness?.baseColorTexture,normalMap:spec.normalTexture,roughnessMap:spec.pbrMetallicRoughness?.metallicRoughnessTexture,metalnessMap:spec.pbrMetallicRoughness?.metallicRoughnessTexture,aoMap:spec.occlusionTexture};
    const textures=[];for(const [role,info] of Object.entries(roles))if(info){const textureSpec=data.textures?.[info.index],image=data.images?.[textureSpec?.source??textureSpec?.extensions?.KHR_texture_basisu?.source];if(!image){failures.push(`${mesh.name}: missing ${role} image`);continue;}const t=new THREE.Texture();textures.push(t);if(image.bufferView!==undefined){const view=data.bufferViews[image.bufferView];if(!view||view.byteLength<=0||(view.byteOffset??0)+view.byteLength>bin.length){failures.push(`${mesh.name}: invalid ${role} image buffer`);continue;}const bytes=bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);if(image.mimeType==='image/png'&&bytes.length>=24)t.image={width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};}const transform=info.extensions?.KHR_texture_transform;t.channel=transform?.texCoord??info.texCoord??0;t.colorSpace=role==='map'?THREE.SRGBColorSpace:THREE.NoColorSpace;t.offset.fromArray(transform?.offset??[0,0]);t.repeat.fromArray(transform?.scale??[1,1]);t.rotation=transform?.rotation??0;t.updateMatrix();m[role]=t;}
    for(const issue of validateMaterial(m,g,!!spec.extras?.lanternSurface))failures.push(`${mesh.name??'(mesh)'}/${issue.material}: ${issue.message}`);
    const surface=spec.extras?.lanternSurface;if(surface&&(![1,2,3].includes(surface.version)||!Number.isFinite(surface.depth)||surface.depth<0))failures.push('invalid surface metadata');
    if(surface?.family&&!Object.hasOwn(recipes.families,surface.family))failures.push('unknown material recipe family');if(surface?.recipeVersion&&surface.recipeVersion!==recipes.version)failures.push('unsupported material recipe version');
    if(surface?.bakeRecipe){for(const [family,height] of Object.entries(surface.bakeRecipe.heights)){if(recipes.families[family]?.heightMetres!==height)failures.push(`stale ${family} relief bake; re-prepare this asset`);}for(const [family,fields] of Object.entries(surface.bakeRecipe.fields)){if(!isDeepStrictEqual(fields??null,recipes.fieldProfiles[surface.bakeRecipe.fieldProfile]?.[family]??null))failures.push(`stale ${family} field profile; re-prepare this asset`);}}
    g.dispose();m.dispose();textures.forEach(t=>t.dispose());
  }
  return failures;
}
if(isMain(import.meta.url))await cli(async()=>{
 const args=parseArgs(process.argv.slice(2),{'--file':'value'});if(args['--help']){console.log('Usage: node scripts/assets/surfaces/validate.mjs [--file PATH]\nValidate prepared material maps, UV coverage, tangents and coordinate frames.');return;}
 const recipes=JSON.parse(await readFile(resolve(root,'assets/material-recipes.json'))),ground=JSON.parse(await readFile(resolve(root,'assets/textures/environment/ground/recipe.json')));
 const expected={heights:Object.fromEntries(['earth','litter','rocky-soil','stone'].map(family=>[family,recipes.families[family].heightMetres])),scales:recipes.groundBakeScales,stoneScale:recipes.stoneProjection.bakeScale,stoneFields:recipes.stoneProjection.fields};
 if(!isDeepStrictEqual(ground,expected))throw Error('Ground/stone field recipes are stale; re-prepare ground fields with environment.mjs --ground-fields.');
 const manifest=JSON.parse(await readFile(resolve(root,'assets/textures/environment/manifest.json')));const paths=args['--file']?[resolve(args['--file'])]:[...new Set([...manifest.assets,...Object.values(manifest.areaAssets??{}).flat(),...manifest.showcase.assets].map(a=>resolve(root,'public',a.url.slice(1))))];
 let checked=0,absent=0;const failures=[];for(const path of paths){try{const issues=await validateGlb(path);checked++;failures.push(...issues.map(issue=>`${path}: ${issue}`));}catch(e){if(e.code==='ENOENT'&&!args['--file'])absent++;else throw e;}}
 if(failures.length)throw Error(failures.join('\n'));console.log(`Validated ${checked} prepared material assets; ${absent} optional files absent.`);
});
