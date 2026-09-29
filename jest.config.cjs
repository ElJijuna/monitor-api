module.exports = {
  coverageProvider: 'v8',
  coverageThreshold: {
    global: { branches: 95, functions: 95, lines: 95, statements: 95 },
  },
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': '<rootDir>/jest.transform.cjs',
  },
};
