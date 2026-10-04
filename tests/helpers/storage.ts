/** In-memory browser storage with explicit read/write failures for save recovery cases. */
export function memory() {
  const data = new Map<string, string>();
  let writable = true, readable = true;
  return {
    data,
    set writable(value: boolean) { writable = value; },
    set readable(value: boolean) { readable = value; },
    getItem: (key: string) => { if (!readable) throw Error('Read unavailable'); return data.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (!writable) throw Error('Write unavailable'); data.set(key, value); },
    removeItem: (key: string) => { if (!writable) throw Error('Write unavailable'); data.delete(key); },
  };
}
