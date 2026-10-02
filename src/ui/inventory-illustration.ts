/** Original sparse gesture drawing; equipment remains the foreground. */
export const paperDoll = `<svg viewBox="0 0 300 480" aria-hidden="true" class="inv-paper-doll" fill="none">
  <g stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">
    <path d="M135 60c-3-12 1-28 15-29 14 0 19 15 15 28-3 11-8 18-15 19-7-1-12-8-15-18Z"/>
    <path d="m140 76-4 17-26 11-31-13-55-44-8-1 3 8 54 54 45 13-5 65 9 53-31 76-35 109 7 9 47-100 31-64h19l31 64 47 100 8-9-36-109-31-76 9-53-5-65 44-13 54-54 3-8-8 1-55 44-31 13-26-11-4-17"/>
    <path d="m123 121 4 62-7 42m57-104-4 62 7 42M126 241l24 28 24-28M101 318l-18 56m116-56 19 56"/>
    <path d="M134 62c-3-15 2-32 17-32M137 96l-28 13-32-14-51-44m137 46 29 12 32-16 49-41M115 190l10 50-32 81-33 110m125-241-10 50 32 81 33 110" opacity=".55"/>
  </g>
</svg>`;

const paths = {
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  sort: '<path d="M5 6h14M5 11h10M5 16h6m5-1 3 3 3-3M19 12v6"/>',
  bag: '<path d="M5 8h14l1 12H4zM8 8V5h8v3"/>',
  stash: '<path d="M4 8h16v12H4zM3 8V4h18v4M10 8v5h4V8"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
} as const;
export function inventoryGlyph(name: keyof typeof paths): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none">${paths[name]}</svg>`;
}
