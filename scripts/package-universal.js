const path = require('path');
const { packager } = require('@electron/packager');

const ignore = [
  /^\/stt($|\/)/,
  /^\/native\/PasteHelper\.cs$/,
  /^\/screenshots($|\/)/,
  /^\/dist($|\/)/,
  /^\/release($|\/)/,
  /^\/installer($|\/)/,
  /^\/docs($|\/)/,
  /^\/scripts($|\/)/,
  /^\/\.github($|\/)/,
  /^\/\.git($|\/)/,
  /^\/\.gitignore$/,
  /^\/\.gitattributes$/,
  /^\/assets\/make_icon\.py$/,
  /__pycache__/,
  /^\/contexte($|\/)/,
  /^\/\.claude($|\/)/,
  /^\/assets\/.*\.icns$/,
  /^\/README\.md$/,
  /^\/CHANGELOG\.md$/
];

(async () => {
  try {
    const appPaths = await packager({
      dir: '.',
      name: 'FreeFlow',
      platform: 'win32',
      arch: 'x64',
      overwrite: true,
      icon: 'assets/icon.ico',
      out: 'release',
      extraResource: ['stt/dist/freeflow-stt-cuda', 'stt/dist/freeflow-stt-rocm'],
      ignore
    });
    console.log('Packaged:', appPaths);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
