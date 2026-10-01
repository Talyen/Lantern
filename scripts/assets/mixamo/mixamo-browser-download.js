/** Paste the prepared copy into the signed-in Mixamo console. Tokens stay here.
 * Exports are serialized: Mixamo reuses per-character export state. Batches use
 * unique catalog IDs as clip names so the collector can verify every file.
 */
(async () => {
  const io = window.lanternMixamoIO = { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };
  const progress = window.lanternMixamoDownload = { stopped: false, status: 'Listing catalog', exported: 0, errors: [], stop() { this.stopped = true; } };
  io.api = async (path, body) => {
    for (let attempt = 0; attempt < 7; attempt++) {
      if (progress.stopped) throw new Error('Download stopped');
      const token = localStorage.getItem('access_token');
      if (!token) throw new Error('Mixamo sign-in is required');
      const response = await fetch('/api/v1' + path, {
        method: body ? 'POST' : 'GET',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'X-Api-Key': 'mixamo2', 'X-Requested-With': 'XMLHttpRequest' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if ([401, 403].includes(response.status)) throw new Error('Adobe session expired; sign in and rerun to resume');
      if (response.status === 429 || response.status >= 500) { await io.sleep(Math.min(60000, 4000 * 2 ** attempt)); continue; }
      if (!response.ok) throw new Error('Mixamo HTTP ' + response.status + ' at ' + path.split('?')[0]);
      return response.json();
    }
    throw new Error('Mixamo export service is busy; rerun to resume');
  };
  io.send = async (path, body) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ session: 'lantern-mixamo-full-library-v2', path, body })], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'lantern-mixamo-receipt-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    await io.sleep(800);
  };
  io.list = async (type) => {
    const products = new Map(); let expected = 0;
    // Search results have score ties that can shift page boundaries. Union
    // several supported page sizes, then require every advertised catalog ID.
    for (const limit of [100, 96, 90, 80, 72, 64, 50, 48]) {
      for (let page = 1; ; page++) {
        const result = await io.api('/products?page=' + page + '&limit=' + limit + '&type=' + type + '&order=&query=');
        expected = result.pagination.num_results;
        for (const product of result.results) products.set(String(product.id), product);
        progress.status = 'Reconciling ' + type + ': ' + products.size + '/' + expected;
        if (products.size === expected) return [...products.values()];
        if (page >= result.pagination.num_pages) break;
        await io.sleep(150);
      }
    }
    throw new Error('Catalog pagination incomplete: ' + products.size + '/' + expected + ' for ' + type);
  };
  io.rig = (await io.api('/characters/primary')).primary_character_id;
  if (!io.rig) throw new Error('Select X Bot in Mixamo first');
  io.monitor = async (uuid) => {
    for (let i = 0; i < 450; i++) {
      await io.sleep(2000);
      const job = await io.api('/characters/' + uuid + '/monitor');
      if (job.status === 'completed' && job.job_result) return typeof job.job_result === 'string' ? job.job_result : job.job_result.url;
      if (job.status === 'failed') throw new Error('Mixamo export job failed');
    }
    throw new Error('Mixamo export timed out');
  };
  io.batch = async (motions, name) => {
    const gms = [];
    for (const motion of motions) {
      const data = motion.gms_hash ? null : await io.api('/products/' + motion.id + '?similar=0&character_id=' + io.rig);
      const config = motion.gms_hash || data.details.gms_hash;
      gms.push({ name: motion.id, 'model-id': config['model-id'], mirror: false, trim: [0, 100], overdrive: 0, params: config.params.map((param) => param[1]).join(','), 'arm-space': 0, inplace: false });
    }
    const job = await io.api('/animations/export', { character_id: io.rig, type: 'MotionPack', product_name: name, gms_hash: gms, preferences: { format: 'fbx7_2019', mesh_motionpack: 'no-character', fps: '30', reducekf: '0' } });
    const url = await io.monitor(job.uuid);
    await io.send('/batch', { key: 'MotionPack:' + name, type: 'MotionPack', name, motions, url });
  };
  const motions = await io.list('Motion');
  const packs = await io.list('MotionPack');
  const characters = await io.list('Character');
  const packMotions = [];
  for (const pack of packs) {
    const data = await io.api('/products/' + pack.id + '?similar=0&character_id=' + io.rig);
    packMotions.push(...data.details.motions.map((motion, index) => ({ ...motion, id: pack.id + '-' + index, sourcePackId: pack.id, sourcePackName: pack.name })));
  }
  await io.send('/catalog', { provider: 'Mixamo', acquiredAt: new Date().toISOString(), animationRig: io.rig, motions, packs, characters, packMotions });
  const complete = new Set(__COMPLETED__);
  const todo = [...motions, ...packMotions].filter((motion) => !complete.has('Motion:' + motion.id));
  progress.total = motions.length + packMotions.length + characters.length;
  console.log('Lantern verified catalog: ' + motions.length + ' motions, ' + packs.length + ' packs (' + packMotions.length + ' members), ' + characters.length + ' characters');
  for (let i = 0; i < todo.length; i += 48) {
    const batch = todo.slice(i, i + 48);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(batch.map((m) => m.id).join(','))))).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
    progress.status = 'Exporting motion batch ' + (Math.floor(i / 48) + 1) + '/' + Math.ceil(todo.length / 48);
    await io.batch(batch, 'lantern-batch-' + hash);
    progress.exported += batch.length;
    console.log('Lantern exported ' + progress.exported + '/' + todo.length + ' pending motions');
    await io.sleep(3000);
  }
  for (const character of characters) {
    const key = 'Character:' + character.id;
    if (complete.has(key)) continue;
    progress.status = 'Exporting character: ' + character.name;
    try {
      const job = await io.api('/animations/export', { character_id: character.id, type: 'Character', product_name: character.name, gms_hash: null, preferences: { format: 'fbx7_2019', mesh: 't-pose' } });
      const url = await io.monitor(job.uuid);
      await io.send('/asset', { key, type: 'Character', productId: character.id, name: character.name, description: character.description, url });
      progress.exported++;
      await io.sleep(3000);
    } catch (error) {
      progress.errors.push({ key, error: String(error) });
      await io.send('/error', { key, error: String(error) });
      if (/session expired/.test(String(error))) throw error;
    }
  }
  progress.status = 'Export finished; verify the local collector counts. Character errors: ' + progress.errors.length;
  console.log(progress.status);
})().catch((error) => { if (window.lanternMixamoDownload) window.lanternMixamoDownload.status = String(error); console.error('Lantern Mixamo: ' + error); });
