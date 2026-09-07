import eslintJest from 'super-configs/eslint/jest';
import eslintTs from 'super-configs/eslint/ts';

export default [
  {
    ignores: [
      'dist/**',
      'docs/**',
      'coverage/**',
      'node_modules/**',
      'bench/**',
      'demo/**',
      'test/browser/**',
      '*.cjs',
    ],
  },
  ...eslintTs,
  ...eslintJest,
  {
    rules: {
      '@stylistic/brace-style': 'off',
      '@stylistic/indent': 'off',
    },
  },
];
