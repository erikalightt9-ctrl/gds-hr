import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['data/**', 'test-output/**', 'node_modules/**'] },
  js.configs.recommended,
  { files: ['src/**/*.mjs', 'scripts/**/*.mjs', 'tests/**/*.mjs', '*.mjs'], languageOptions: { globals: globals.node } },
  { files: ['public/**/*.js'], languageOptions: { sourceType: 'module', globals: globals.browser } },
  // Control-character patterns strip unsafe characters from file names and XML on purpose.
  { rules: { 'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }], 'no-control-regex': 'off' } },
];
