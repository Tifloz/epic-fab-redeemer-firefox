module.exports = {
  ignoreFiles: [
    '.github',
    '.github/**',
    'docs',
    'docs/**',
    'scripts',
    'scripts/**',
    'tests',
    'tests/**',
    'node_modules/**',
    'dist/**',
    'package.json',
    'package-lock.json',
    '.web-ext-config.cjs',
  ],
  build: {
    filename: 'epic-fab-redeemer-v{version}.zip',
    overwriteDest: true,
  },
};
