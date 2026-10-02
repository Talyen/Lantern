import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { withResource } from '../../agents/resources.mjs';
import { inside } from '../../lib/assets.mjs';
import { root, cli, parseArgs } from '../../lib/cli.mjs';

await cli(async () => {
  const args = parseArgs(process.argv.slice(2), { '--source': 'value', '--ffmpeg': 'value' });
  if (args['--help']) { console.log('Prepare selected private sound excerpts: --source LIBRARY_ROOT --ffmpeg EXECUTABLE. Defaults: ~/Documents/Asset Library/Sounds and FFMPEG/ffmpeg (or .local/audio/tools/imageio_ffmpeg/binaries). Masters are read only.'); return; }
  const source = resolve(args['--source'] ?? join(homedir(), 'Documents/Asset Library/Sounds'));
  let ffmpeg = args['--ffmpeg'] ?? process.env.FFMPEG;
  if (!ffmpeg) {
    const binaries = resolve(root, '.local/audio/tools/imageio_ffmpeg/binaries');
    const name = (await readdir(binaries).catch(() => [])).find(name => name.startsWith('ffmpeg-'));
    ffmpeg = name ? join(binaries, name) : 'ffmpeg';
  }
  const invoke = (args, input) => {
    const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { input, maxBuffer: 64 * 1024 ** 2 });
    if (result.error || result.status !== 0) throw new Error(`Audio preparation requires FFmpeg with Vorbis: ${result.error?.message ?? result.stderr.toString()}`);
    return result.stdout;
  };
  await withResource('heavy', async () => {
    const manifest = JSON.parse(await readFile(resolve(root, 'assets/audio/manifest.json'), 'utf8'));
    const output = resolve(root, 'public/vendor/audio'), privateDir = resolve(root, '.local/audio');
    await mkdir(output, { recursive: true }); await mkdir(privateDir, { recursive: true });
    const report = [];
    for (const [id, clip] of Object.entries(manifest.clips)) {
      const inputPath = inside(source, clip.sourcePath);
      const hash = createHash('sha256').update(await readFile(inputPath)).digest('hex');
      if (hash !== clip.sourceSha256) throw new Error(`Sound master changed: ${clip.sourcePath}`);
      const e = clip.edit, rate = manifest.sampleRate, channels = e.channels;
      const bytes = invoke(['-ss', String(e.start), '-t', String(e.duration), '-i', inputPath, '-vn', '-ac', String(channels), '-ar', String(rate), '-f', 'f32le', 'pipe:1']);
      let pcm = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      let peak = pcm.reduce((p, v) => Math.max(p, Math.abs(v)), 0), start = 0, end = pcm.length;
      if (!peak) throw new Error(`Silent source excerpt: ${id}`);
      if (e.trimSilence) {
        const threshold = Math.max(.0008, peak * .025), block = Math.round(rate * .005) * channels;
        const audible = offset => { let sum = 0; for (let k = offset; k < Math.min(offset + block, pcm.length); k++) sum += pcm[k] ** 2; return Math.sqrt(sum / block) > threshold; };
        while (start + block < pcm.length && !audible(start)) start += block;
        while (end - block > start && !audible(end - block)) end -= block;
        start = Math.max(0, start - Math.round(rate * .008) * channels);
        end = Math.min(pcm.length, end + Math.round(rate * .04) * channels);
        pcm = pcm.slice(start, end);
        const fade = Math.min(Math.round(rate * e.fadeOut), Math.floor(pcm.length / channels / 4));
        for (let i = 0; i < fade; i++) for (let c = 0; c < channels; c++) pcm[pcm.length - (fade - i) * channels + c] *= (fade - i) / fade;
        const attack = Math.min(96, Math.floor(pcm.length / channels / 4));
        for (let i = 0; i < attack; i++) for (let c = 0; c < channels; c++) pcm[i * channels + c] *= i / attack;
      } else if (e.loopCrossfade) {
        const fade = Math.round(rate * e.loopCrossfade) * channels, length = pcm.length;
        const loop = new Float32Array(length - fade);
        loop.set(pcm.subarray(fade, length - fade));
        for (let i = 0; i < fade; i++) { const mix = Math.floor(i / channels) / (fade / channels - 1); loop[length - 2 * fade + i] = pcm[length - fade + i] * (1 - mix) + pcm[i] * mix; }
        pcm = loop;
      }
      if (clip.loop && (clip.loopStart !== 0 || Math.abs(clip.loopEnd - pcm.length / channels / rate) > 1/rate)) throw new Error(`Update manifest loop points for edited excerpt: ${id}`);
      peak = pcm.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
      const scale = 10 ** (e.peakDb / 20) / peak;
      for (let i = 0; i < pcm.length; i++) pcm[i] *= scale;
      const target = inside(resolve(root, 'public'), clip.url.slice(1));
      invoke(['-y', '-f', 'f32le', '-ar', String(rate), '-ac', String(channels), '-i', 'pipe:0', '-map_metadata', '-1', '-c:a', 'libvorbis', '-b:a', channels === 2 ? '160k' : '96k', target], Buffer.from(pcm.buffer));
      const encoded = await readFile(target);
      const decoded = invoke(['-i', target, '-f', 'f32le', '-ac', String(channels), '-ar', String(rate), 'pipe:1']);
      const floats = new Float32Array(decoded.buffer.slice(decoded.byteOffset, decoded.byteOffset + decoded.byteLength));
      const decodedPeak = floats.reduce((p, v) => Math.max(p, Math.abs(v)), 0);
      if (decodedPeak >= 1 || floats.some(v => !Number.isFinite(v))) throw new Error(`Clipped or invalid export: ${id}`);
      report.push({ id, source: inputPath, sourceSha256: hash, trimStart: e.start + start / channels / rate, duration: pcm.length / channels / rate, channels, bytes: encoded.length, peakDb: 20 * Math.log10(decodedPeak), seamDelta: clip.loop ? Math.abs(floats[0] - floats[floats.length - channels]) : null, outputSha256: createHash('sha256').update(encoded).digest('hex') });
    }
    await writeFile(join(privateDir, 'preparation.json'), JSON.stringify({ manifestSha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'), files: report }, null, 2) + '\n');
    console.log(`Prepared ${report.length} sounds; ${(report.reduce((n, r) => n + r.bytes, 0) / 1048576).toFixed(2)} MiB. Technical evidence: .local/audio/preparation.json. Listening quality remains a separate review.`);
  });
});
