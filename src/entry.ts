if (new URLSearchParams(location.search).get('lab') === 'animations') {
  await import('./animation-lab');
} else {
  await import('./main');
}
export {};
