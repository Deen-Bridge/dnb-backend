export default {
  testEnvironment: "node",
  injectGlobals: true,
  transform: {},
  setupFiles: ["<rootDir>/test/jest.setup.js"],
  testMatch: ["<rootDir>/test/**/*.test.js"],
  testTimeout: 60000,
};
