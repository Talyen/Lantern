import { loadingScreen } from './ui/loading';
import { initializeDiagnostics, recordFailure } from './diagnostics/report';
initializeDiagnostics();
const lab = import.meta.env.DEV && ['characters', 'weapons', 'animations', 'assets', 'fsr'].includes(new URLSearchParams(location.search).get('lab') ?? '');
if (lab) loadingScreen.dismiss();
try {
  // Only the opt-in authoring comparison page uses a seeded world/effects stream.
  if (import.meta.env.DEV) {
    const { fsrComparison, comparisonRandom } = await import('./labs/fsr/settings');
    if (fsrComparison) Math.random = comparisonRandom;
  }
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('lab') === 'fsr') {
    await import('./labs/fsr/focused');
  } else if (import.meta.env.DEV && new URLSearchParams(location.search).get('lab') === 'assets') {
    await import('./labs/assets/asset-review-lab');
  } else if (import.meta.env.DEV && new URLSearchParams(location.search).get('lab') === 'characters') {
    await import('./labs/characters/character-gallery');
  } else if (import.meta.env.DEV && new URLSearchParams(location.search).get('lab') === 'weapons') {
    await import('./labs/weapons/weapon-gallery');
  } else if (import.meta.env.DEV && new URLSearchParams(location.search).get('lab') === 'animations') {
    if (new URLSearchParams(location.search).get('study') === 'ultimates') await import('./labs/animations/ultimate-lab');
    else await import('./labs/animations/animation-lab');
  } else {
    await import('./clearing/clearing');
  }
} catch (error) {
  recordFailure('startup', error);
  console.error(error);
  const mount = document.getElementById('scene') ?? document.getElementById('lab-canvas') ?? document.getElementById('app')!;
  mount.dataset.renderError = String(error);
  loadingScreen.fail(loadingScreen.current, error);
}
export {};
