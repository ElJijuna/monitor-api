import { createEslintConfig } from 'super-configs/eslint';

export default createEslintConfig({
  runtime: 'node',
  language: 'ts',
  testFramework: 'jest',
  ignores: [
    'dist/**',
    'docs/**',
    'coverage/**',
    'node_modules/**',
    'bench/**',
    'demo/**',
    'test/browser/**',
    '**/*.cjs',
  ],
  overrides: [
    {
      rules: {
        '@stylistic/brace-style': 'off',
        '@stylistic/indent': 'off',
      },
    },
  ],
});
