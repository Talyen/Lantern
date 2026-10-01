import { unlink } from 'node:fs/promises';
import { cli,parseArgs } from '../lib/cli.mjs';
import { readRecord,statePath,browser } from './common.mjs';
await cli(async()=>{const args=parseArgs(process.argv.slice(2));if(args['--help']){console.log('Usage: npm run levels:stop');return;}const state=await readRecord();await browser(state,['close']);const owner=await fetch(`${state.url}/__level-owner`,{signal:AbortSignal.timeout(1000)}).then(r=>r.json()).catch(()=>null);if(owner?.token===state.token)try{process.kill(-state.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}await unlink(statePath);console.log('Closed owned level browser and server.');});
