import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {cli,root} from '../lib/cli.mjs';
import {probeSignature} from './probe.mjs';
await cli(async()=>{
 if(process.env.CI||!existsSync(resolve(root,'public/vendor'))){console.log('Native GPU proof requires supported hardware; this asset-free/CI gate validates the material contract only. Run materials:probe on the native acceptance host.');return;}
 let report;try{report=JSON.parse(await readFile(resolve(root,'.local/level-design/material-probe/latest.json')));}catch{throw Error('Run npm run materials:probe in an owned authoring preview before handing off this material-adapter/dependency change.');}
 if(!report.passed||report.signature!==await probeSignature())throw Error('Native material proof is stale or failed. Run npm run materials:probe against these sources.');
 console.log('PASS current Native GPU material proof');
});
