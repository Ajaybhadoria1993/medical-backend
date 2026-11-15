/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  transform: {
    // transpile-only: full type-checking is covered by `npm run typecheck`.
    // Type-checking per worker built a whole TS program each time (~30s/file, GBs of RAM).
    '^.+\\.tsx?$': ['ts-jest', { isolatedModules: true }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/src/main/global/__tests__/setup.ts'],
  // opt in with `npm run test:coverage` / `--coverage`
  collectCoverage: false,
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  // Each worker loads most of the app; more than 2 exhausts a 16GB machine.
  maxWorkers: 2,
  workerIdleMemoryLimit: '512MB',
};
