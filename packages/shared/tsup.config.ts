import { defineConfig } from 'tsup';

// Built once to CommonJS (NestJS) and ESM (Next.js) so both apps import the same rules.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
});
