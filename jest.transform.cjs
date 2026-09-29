const { transformSync } = require('esbuild');

module.exports = {
  process(sourceText, sourcePath) {
    // ES2022 keeps native #private fields and exact source maps keep coverage on the .ts lines.
    const { code, map } = transformSync(sourceText, {
      format: 'esm',
      loader: sourcePath.endsWith('.tsx') ? 'tsx' : 'ts',
      sourcefile: sourcePath,
      sourcemap: 'external',
      target: 'es2022',
    });

    return { code, map };
  },
};
