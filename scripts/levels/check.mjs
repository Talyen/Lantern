import { access,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cli,parseArgs,root } from '../lib/cli.mjs';
import { changedUses, reviewBlockers } from '../assets/review/index.mjs';
import { readAreas } from './common.mjs';
import { validateAreas,assetReferences } from '../../src/levels/validation.ts';
await cli(async()=>{
  const args=parseArgs(process.argv.slice(2),{'--assets':'boolean','--base':'value'});
  if(args['--help']){console.log('Usage: npm run levels:check; npm run levels:assets');return;}
  const areas=await readAreas(),errors=validateAreas(areas);if(errors.length)throw new Error(errors.join('\n'));
  const ids=[...new Set(Object.values(areas).flatMap(a=>assetReferences(a).flatMap(r=>'libraryId'in r?[r.libraryId]:[])))].sort();
  const selectedPath=resolve(root,'assets/library-selection.json'),selected=JSON.parse(await readFile(selectedPath,'utf8'));
  if(args['--assets']){await writeFile(selectedPath,JSON.stringify([...new Set([...selected,...ids])].sort(),null,2)+'\n');console.log(`Selected ${ids.length} referenced library IDs (retained existing selections).`);return;}
  const warnings=[];
  let catalog; if(ids.length)try{catalog=JSON.parse(await readFile(resolve(root,'public/vendor/synty/library/catalog.json'),'utf8'));}catch{warnings.push('Private library catalog unavailable');}
  for(const id of ids){if(!selected.includes(id))errors.push(`Unselected library ID: ${id}; run npm run levels:assets`);if(catalog&&catalog.assets[id]?.status!=='converted')errors.push(`Unconverted library ID: ${id}`);}
  for(const a of Object.values(areas))for(const ref of assetReferences(a))if('url'in ref)try{await access(resolve(root,'public',ref.url.slice(1)));}catch{warnings.push(`${a.id}: missing optional art ${ref.url}`);}
  const review=await changedUses(root,args['--base']??'HEAD');
  for(const issue of review.issues)errors.push(`New asset use is blocked: ${issue.name} (${issue.state}) ${issue.id}`);
  const excluded = await reviewBlockers(review.index);
  if(excluded.length)warnings.push(`${excluded.length} existing visual references are blocked or unavailable; npm run assets:review:report`);
  if(errors.length)throw new Error(errors.join('\n'));console.log(`Validated ${Object.keys(areas).length} areas and gate links.`);if(warnings.length)console.log([...new Set(warnings)].join('\n'));
});
