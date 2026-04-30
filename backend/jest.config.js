export default {
  testEnvironment: 'node',
  transform: {},
  testTimeout: 30000,
  testPathIgnorePatterns: ['/node_modules/'],
  clearMocks: true,
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  verbose: true,
  detectOpenHandles: true,
  forceExit: true,
  maxWorkers: 1
};
