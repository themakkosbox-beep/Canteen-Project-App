const config = require('eslint-config-next/core-web-vitals');

module.exports = [
  ...config,
  {
    ignores: [
      'electron-app/dist/**',
      'resources/**',
    ],
  },
];
