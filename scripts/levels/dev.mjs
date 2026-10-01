import { spawn } from 'node:child_process';
import { open, mkdir, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { cli, parseArgs, root } from '../lib/cli.mjs';
import { evidence,statePath,readAreas,readRecord,readState,command,browser,ready,evaluate } from './common.mjs';
await cli(async()=>{
  const args=parseArgs(process.argv.slice(2),{'--area':'value','--renderer':'value'});
  if(args['--help']){console.log('Usage: npm run levels:dev -- [--area ID] [--renderer webgpu]');return;}
  const area=args['--area']??'clearing', renderer=args['--renderer']??'webgpu';
  if(!(await readAreas())[area])throw new Error(`Unknown area ${area}`);
  if(renderer!=='webgpu')throw new Error('Lantern requires native WebGPU; renderer selection is no longer supported.');
  try {await command('agent-browser',['--version']);}catch {throw new Error('Install agent-browser (brew install agent-browser), then agent-browser install.');}
  await mkdir(evidence,{recursive:true});
  const existing=await readState().catch(()=>null);
  if(existing){if(existing.renderer!==renderer)throw new Error('Stop the obsolete preview session, then restart it with native WebGPU.');await ready(existing);await evaluate(existing,`window.lanternAuthoring.selectArea(${JSON.stringify(area)})`);await ready(existing,area);console.log(`Existing session: ${existing.url}/?author=levels&area=${area}`);return;}
  const stale=await readRecord().catch(()=>null);if(stale){await browser(stale,['close']).catch(()=>{});await unlink(statePath).catch(()=>{});}
  const lock=await open(resolve(evidence,'starting.lock'),'wx').catch(()=>{throw new Error('Another level session is starting; inspect .local/level-design/starting.lock.');});
  let child,state;
  try {
    const port=await new Promise((accept,reject)=>{const server=createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const selected=server.address().port;server.close(()=>accept(selected));});});
    const token=randomUUID(),session=`lantern-level-${token}`,url=`http://127.0.0.1:${port}`;
    const log=await open(resolve(evidence,'vite.log'),'a');
    child=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,env:{...process.env,LANTERN_LEVEL_SESSION:token},detached:true,stdio:['ignore',log.fd,log.fd]});child.unref();await log.close();
    state={pid:child.pid,token,session,url,renderer,started:new Date().toISOString()};
    let started=false;for(let i=0;i<100;i++){try {const value=await fetch(`${url}/__level-owner`,{signal:AbortSignal.timeout(500)}).then(r=>r.json());if(value.token===token){started=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
    if(!started)throw new Error('Vite startup failed; inspect .local/level-design/vite.log');
    await writeFile(statePath,JSON.stringify(state,null,2)+'\n');
    await browser(state,['open',`${url}/?author=levels&area=${area}&fpsLimit=0`]);
    await browser(state,['set','viewport','1920','1080']);
    try { await ready(state,area); } catch(error) { console.error(await browser(state,['errors']).catch(()=>'')); console.error(await evaluate(state,'({bridge:typeof window.lanternAuthoring,error:document.querySelector("#scene").dataset.renderError})').catch(()=>'')); throw error; }
    console.log(`Ready: ${url}/?author=levels&area=${area}\nSession: ${session}\nCapture: npm run levels:capture -- --area=${area}`);
  }catch(error){if(state)await browser(state,['close']).catch(()=>{});if(child?.pid)try{process.kill(-child.pid,'SIGTERM');}catch{}await unlink(statePath).catch(()=>{});throw error;}
  finally{await lock.close();await unlink(resolve(evidence,'starting.lock')).catch(()=>{});}
});
