import { initializeDiagnostics, recordFailure, diagnosticExportButton } from './diagnostics/report';
initializeDiagnostics();
try {
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('lab') === 'characters') {
    await import('./labs/characters/character-gallery');
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
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = import.meta.env.DEV && new URLSearchParams(location.search).get('lab') === 'characters'
    ? `Unable to open characters. ${error instanceof Error ? error.message : String(error)}${/WebGPU/i.test(String(error)) ? ' Use a supported browser with hardware acceleration enabled, update your graphics driver, then reload.' : ''}`
    : `Unable to start Lantern. ${error instanceof Error ? error.message : String(error)}${/WebGPU/i.test(String(error)) ? ' Use a supported browser with hardware acceleration enabled, update your graphics driver, then reload.' : ''}`;
  message.style.cssText = 'position:relative;margin:24px;max-width:36rem;color:#eee;background:#172f31;padding:16px;z-index:100';
  const actions = document.createElement('div');
  actions.style.cssText = 'position:relative;margin:24px;z-index:100';
  actions.append(diagnosticExportButton());
  mount.replaceChildren(message, actions);
}
export {};
