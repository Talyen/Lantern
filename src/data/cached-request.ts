/** Share in-flight/successful loads, but let an explicit retry replace a failed load. */
export function cachedRequest<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let request = cache.get(key);
  if (!request) {
    request = Promise.resolve().then(load);
    cache.set(key, request);
    const current = request;
    request.catch(() => { if (cache.get(key) === current) cache.delete(key); });
  }
  return request;
}
