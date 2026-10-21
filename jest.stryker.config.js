// Jest config used only by Stryker (see stryker.conf.json). It runs the unit
// tests that live next to the mutated mongo/ modules instead of the whole app
// suite, so each mutant is checked against the tests written for it.
export default {
  // Stryker's node env reports per-test coverage back to Stryker (needed under ESM).
  testEnvironment: "@stryker-mutator/jest-runner/jest-env/node",
  injectGlobals: true,
  transform: {},
  setupFiles: ["<rootDir>/test/jest.setup.cjs"],
  testMatch: ["<rootDir>/mongo/**/__tests__/**/*.test.js", "<rootDir>/test/courseRepository.test.js"],
  testTimeout: 60000,
};
