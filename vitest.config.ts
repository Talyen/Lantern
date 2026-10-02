import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node', maxWorkers: ['true', '1'].includes(process.env.CI ?? '') ? 2 : 1 } });
