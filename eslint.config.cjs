/**
 * ESLint flat configuration for Node.js + ESM
 * Uses @eslint/js recommended + eslint-plugin-n + eslint-plugin-promise
 * sourceType: module (project uses "type": "module")
 * @see https://eslint.org/docs/latest/use/configure/configuration-files/type-system#flat-configuration
 */
module.exports = [
  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      ecmaVersion: 'latest',
      // Node.js globals
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        // Browser/API globals available in Node.js
        fetch: 'readonly',
        performance: 'readonly',
        // Timer globals
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        // URL/Params globals
        URL: 'readonly',
        URLSearchParams: 'readonly',
        // Immediate
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
      },
    },
    plugins: {
      promise: require('eslint-plugin-promise'),
    },
    rules: {
      'no-unused-vars': 'error',
      'no-undef': 'error',
      'eqeqeq': 'error',
      'no-console': ['error', { allow: ['warn', 'error', 'log'] }],
      'no-constant-condition': 'error',
      'no-fallthrough': 'error',

      // eslint-plugin-promise rules
      'promise/always-return': 'error',
      'promise/avoid-new': 'error',
      'promise/prefer-await-to-callbacks': 'error',

      // General quality
      'no-warning-comments': 'off',
    },
  },

  // Test files - provide Jest globals and relax unused-var
  // Covers ALL test file locations:
  // - test/* test files
  // - mongo/**/*.test.js and mongo/**/__tests__/*.test.js
  // - src/**/*.test.js and src/**/__tests__/*.test.js
  {
    files: ['test/**/*.test.js', 'test/**/*.spec.js',
      'mongo/**/*.test.js', 'mongo/**/__tests__/*.test.js',
      'src/**/*.test.js', 'src/**/__tests__/*.test.js'],
    languageOptions: {
      sourceType: 'module',
      // Jest globals
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        // Node.js globals (already available but explicitly set)
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        performance: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        jest: 'readonly',
      },
    },
    plugins: {
      promise: require('eslint-plugin-promise'),
    },
    rules: {
      'no-unused-vars': 'off',
    },
  },

  // Ignore patterns
  {
    ignores: ['node_modules/', 'dist/', 'build/', '*.test.js', '*.spec.js'],
  },
];