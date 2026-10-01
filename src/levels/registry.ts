import type { AreaDefinition } from './types';
const modules = import.meta.glob('./areas/*.json', { eager: true, import: 'default' });
export const areas = Object.fromEntries(Object.entries(modules).map(([path, value]) => [path.split('/').at(-1)!.replace(/\.json$/, ''), value])) as Record<string, AreaDefinition>;
