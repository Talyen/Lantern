import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cli,parseArgs,root } from '../lib/cli.mjs';
await cli(async()=>{
  const args=parseArgs(process.argv.slice(2),{'--query':'value','--limit':'value'});
  if(args['--help']){console.log('Usage: npm run levels:find -- --query TEXT [--limit 20]');return;}
  const query=(args['--query']??'').toLowerCase(),limit=Number(args['--limit']??20);
  if(!query||!Number.isInteger(limit)||limit<1||limit>100)throw new Error('Supply a query and limit between 1 and 100.');
  let catalog;try{catalog=JSON.parse(await readFile(resolve(root,'public/vendor/synty/library/catalog.json'),'utf8'));}catch{throw new Error('Private catalog unavailable; use existing standalone vendor URLs or prepare the library explicitly.');}
  const matches=Object.values(catalog.assets).filter(a=>a.status==='converted'&&['model','mesh','assembly'].includes(a.kind)&&`${a.id} ${a.name} ${a.pack}`.toLowerCase().includes(query));
  console.log(JSON.stringify({total:matches.length,assets:matches.slice(0,limit).map(a=>({id:a.id,name:a.name,pack:a.pack,kind:a.kind,bounds:a.bounds,warnings:a.warnings}))},null,2));
});
