const path = require('node:path');
// Bundled gameplay needs no Node modules at runtime. Keep source/private inputs out.
const allowed = candidate => {
  const file = candidate.replaceAll('\\', '/').replace(/^\//, '');
  return !file || file === 'package.json' || file === 'electron' || ['electron/main.cjs', 'electron/preload.cjs', 'electron/reporting.cjs'].includes(file) || file === 'dist' || file.startsWith('dist/');
};
module.exports = {
  outDir: path.resolve(__dirname, '.local/desktop/out'),
  packagerConfig: { name: 'Lantern', executableName: 'Lantern', appBundleId: 'com.talyen.lantern', asar: true, prune: false, ignore: candidate => !allowed(candidate) },
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['win32', 'darwin'] }],
};
