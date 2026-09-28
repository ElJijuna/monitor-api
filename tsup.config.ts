import { defineConfig } from 'tsup';

const entry = { index: 'src/index.ts', 'react/index': 'src/react/index.ts' };

export default defineConfig([
  {
    entry,
    format: ['esm'],
    splitting: false,
    dts: true,
    sourcemap: true,
    external: ['react', 'ssignal', 'web-vitals'],
  },
  {
    entry,
    format: ['cjs'],
    dts: true,
    sourcemap: true,
    external: ['react', 'web-vitals'],
    // Bundled for CommonJS: esbuild's Node-mode interop turns `import SSignal from 'ssignal'`
    // into the whole `exports` object, so `new SSignal()` would throw at runtime.
    noExternal: ['ssignal'],
  },
]);
