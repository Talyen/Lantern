const punctuation: Record<string, string> = {
  '.': 'Period', '>': 'Period', ',': 'Comma', '<': 'Comma',
  '/': 'Slash', '?': 'Slash', ';': 'Semicolon', ':': 'Semicolon',
  "'": 'Quote', '"': 'Quote', '[': 'BracketLeft', '{': 'BracketLeft',
  ']': 'BracketRight', '}': 'BracketRight', '\\': 'Backslash', '|': 'Backslash',
  '`': 'Backquote', '~': 'Backquote', '-': 'Minus', '_': 'Minus', '=': 'Equal', '+': 'Equal',
};
const shiftedDigits = ')!@#$%^&*(';
const numpad: Record<string, string> = {
  End: '1', ArrowDown: '2', PageDown: '3', ArrowLeft: '4', Clear: '5',
  ArrowRight: '6', Home: '7', ArrowUp: '8', PageUp: '9', Insert: '0', Delete: 'Decimal',
  Enter: 'Enter', '.': 'Decimal', ',': 'Decimal', '+': 'Add', '-': 'Subtract', '*': 'Multiply', '/': 'Divide',
};

/** Prefer physical codes, accepting code-less keyboard input from browser automation/accessibility tools. */
export function keyboardInput(event: Pick<KeyboardEvent, 'code' | 'key' | 'location'>): string {
  if (event.code) return `key:${event.code}`;
  const { key, location } = event;
  let code: string;
  if (location === 3 && (/^[0-9]$/.test(key) || numpad[key])) code = `Numpad${numpad[key] ?? key}`;
  else if (punctuation[key]) code = punctuation[key];
  else if (/^[a-z]$/i.test(key)) code = `Key${key.toUpperCase()}`;
  else if (/^[0-9]$/.test(key)) code = `Digit${key}`;
  else if (key.length === 1 && shiftedDigits.includes(key)) code = `Digit${shiftedDigits.indexOf(key)}`;
  else if (['Shift', 'Control', 'Alt', 'Meta'].includes(key)) code = key + (location === 2 ? 'Right' : 'Left');
  else code = key === ' ' ? 'Space' : key;
  return `key:${code}`;
}
