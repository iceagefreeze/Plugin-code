const { join } = require('path')

module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaFeatures: {
      impliedStrict: true,
      jsx: true,
    },
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['web/tsconfig.json', 'backend/tsconfig.json'],
    tsconfigRootDir: join(__dirname, '..'),
  },
  ignorePatterns: ['config/.eslintrc.js', '.eslintrc.js'],
  plugins: ['react-hooks', '@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
    'plugin:yml/standard',
    'prettier',
  ],
  overrides: [
    {
      files: ['*.tsx', '*.ts'],
      parser: '@typescript-eslint/parser',
      rules: {
        '@typescript-eslint/no-this-alias': 'off',
        '@typescript-eslint/ban-types': 'warn',
        '@typescript-eslint/ban-ts-comment': 'warn',
        '@typescript-eslint/no-unused-vars': 'warn',
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/member-ordering': 'warn',
        '@typescript-eslint/no-redundant-type-constituents': 'warn',
        '@typescript-eslint/explicit-module-boundary-types': 'warn',
        '@typescript-eslint/prefer-optional-chain': 'error',
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/consistent-generic-constructors': 'error',
        '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
        '@typescript-eslint/no-use-before-define': [
          'error',
          {
            functions: false,
            typedefs: false,
          },
        ],
        '@typescript-eslint/consistent-type-exports': [
          'error',
          {
            fixMixedExportsWithInlineTypeSpecifier: true,
          },
        ],
      },
    },
    {
      files: ['*.tsx'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: "JSXOpeningElement[name.name='button']",
            message: '禁止直接使用 <button>，请使用 @ones-design/core 的 Button 组件。',
          },
          {
            selector: "JSXOpeningElement[name.name='form']",
            message: '禁止直接使用 <form>，请使用 @ones-design/core 的 Form 组件。',
          },
          {
            selector: "JSXOpeningElement[name.name='input']",
            message: '禁止直接使用 <input>，请使用 @ones-design/core 的 Input 组件。',
          },
          {
            selector: "JSXOpeningElement[name.name='select']",
            message: '禁止直接使用 <select>，请使用 @ones-design/core 的 Select 组件。',
          },
          {
            selector: "JSXOpeningElement[name.name='textarea']",
            message:
              '禁止直接使用 <textarea>，请使用 @ones-design/core 的 Input.TextArea 组件。',
          },
        ],
      },
    },
    {
      files: ['*.yaml', '*.yml'],
      parser: 'yaml-eslint-parser',
      parserOptions: {
        defaultYAMLVersion: '1.2',
      },
      rules: {
        'yml/quotes': 'off',
        'yml/spaced-comment': 'warn',
        'yml/no-empty-document': 'warn',
        'yml/no-empty-mapping-value': 'warn',
      },
    },
  ],
  rules: {
    'no-use-before-define': 'off',
    'no-constant-binary-expression': 'error',
    'no-console': [
      'warn',
      {
        allow: ['error', 'warn'],
      },
    ],
    'object-shorthand': [
      'error',
      'always',
      {
        avoidQuotes: true,
      },
    ],
    'prefer-const': [
      'error',
      {
        destructuring: 'all',
      },
    ],
    'react-hooks/exhaustive-deps': 'error',
  },
}
