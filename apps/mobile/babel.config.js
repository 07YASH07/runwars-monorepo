const path = require('path');
const fs = require('fs');

module.exports = function (api) {
  api.cache(true);
  // Resolve to the real path so Metro/Watchman works when building via a
  // junction drive (e.g., C:\rw) where relative paths point through the
  // junction and Watchman can't follow it.
  const sharedSrc = fs.realpathSync(path.resolve(__dirname, '../../packages/shared/src'));
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./src'],
          alias: {
            '@': './src',
            '@runwars/shared': sharedSrc,
          },
          extensions: ['.ios.js', '.android.js', '.js', '.ts', '.tsx', '.json'],
        },
      ],
    ],
  };
};
