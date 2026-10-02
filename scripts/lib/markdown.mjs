// GitHub-style heading IDs, including duplicate suffixes; fenced examples are not headings.
export function markdownHeadings(text) {
  const ids = new Set(), headings = [];
  const lines = text.split(/\r?\n/);
  let fence;
  let previous = '';
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = undefined;
      previous = '';
      continue;
    }
    if (marker) { fence = marker[1]; previous = ''; continue; }
    const heading = line.match(/^ {0,3}#{1,6}(?:\s+(.+?)\s*#*\s*|\s*)$/)?.[1]
      ?? (previous.trim() && /^ {0,3}(?:=+|-+)\s*$/.test(line) ? previous.trim() : undefined);
    if (heading !== undefined) {
      const base = heading.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '').replace(/[*`~]/g, '')
        .toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
      let id = base;
      for (let suffix = 1; ids.has(id); suffix++) id = `${base}-${suffix}`;
      ids.add(id);
      const atx = line.match(/^ {0,3}(#{1,6})/);
      headings.push({ id, level: atx ? atx[1].length : line.trim().startsWith('=') ? 1 : 2, startLine: atx ? index + 1 : index });
      previous = '';
    } else previous = line;
  }
  return headings.map((heading, index) => {
    const next = headings.slice(index + 1).find(item => item.level <= heading.level);
    return { ...heading, endLine: next ? next.startLine - 1 : lines.length };
  });
}

export function headingIds(text) { return new Set(markdownHeadings(text).map(heading => heading.id)); }
