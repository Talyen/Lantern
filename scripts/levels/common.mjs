import { readFile, readdir, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { root } from '../lib/cli.mjs';
export const evidence = resolve(root, '.local/level-design');
export const statePath = resolve(evidence, 'session.json');
const execute = promisify(execFile);
export async function command(file, args, timeout = 30000) { try { return (await execute(file, args, { cwd: root, timeout, maxBuffer: 16 * 1024 * 1024 })).stdout; } catch (e) { throw new Error(`${file}: ${e.stderr || e.stdout || e.message}`); } }
export async function readAreas() { const dir = resolve(root, 'src/levels/areas'); return Object.fromEntries(await Promise.all((await readdir(dir)).filter(f => f.endsWith('.json')).map(async f => { const area = JSON.parse(await readFile(resolve(dir,f),'utf8')); return [f.slice(0,-5),area]; }))); }
export async function readRecord() { const state = JSON.parse(await readFile(statePath, 'utf8')); if (state.session !== `lantern-level-${state.token}` || !Number.isInteger(state.pid) || state.pid < 1 || !/^http:\/\/127\.0\.0\.1:\d+$/.test(state.url)) throw new Error('Invalid owned session record'); return state; }
export async function readState() { try { const state = await readRecord(); const owner = await fetch(`${state.url}/__level-owner`, { signal: AbortSignal.timeout(3000) }).then(r => r.json()); if (owner.token !== state.token || !state.session.startsWith('lantern-level-')) throw new Error('Session ownership mismatch'); return state; } catch (e) { throw new Error(`No live owned level session. Run npm run levels:dev (${e.message}).`); } }
export async function browser(state, args, timeout=30000) { return command('agent-browser',['--session',state.session,'--headed','false',...args],timeout); }
export async function evaluate(state, script, timeout=30000) { const raw=await browser(state,['--json','eval',script],timeout); let result;try {result=JSON.parse(raw);}catch {throw new Error(`Invalid browser output: ${raw.slice(0,300)}`);} if(!result.success)throw new Error(result.error || JSON.stringify(result));return result.data?.result; }
export async function ready(state, expectedArea) { return evaluate(state, `(async()=>{const deadline=performance.now()+20000;while(performance.now()<deadline){const a=window.lanternAuthoring,d=a?.diagnostics();if(d?.errors.length)throw new Error(d.errors.join('\\n'));if(d?.ready&&(${JSON.stringify(expectedArea)}===undefined||d.area===${JSON.stringify(expectedArea)}))return d;await new Promise(r=>setTimeout(r,50));}throw new Error('Scene readiness timed out');})()`); }
export async function outputDir(area, revision) { const path=resolve(evidence,area,String(revision));await mkdir(path,{recursive:true});return path; }
