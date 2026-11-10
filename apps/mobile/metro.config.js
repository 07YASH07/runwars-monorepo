const { getDefaultConfig } = require("expo/metro-config");
const path = require('path');
const fs = require('fs');

// Resolve real path to handle junction/symlink builds (e.g., C:\rw junction)
const projectRoot = fs.realpathSync(__dirname);
const workspaceRoot = path.resolve(projectRoot, '../..');

const defaultConfig = getDefaultConfig(projectRoot);

// Watch entire monorepo so Metro can serve workspace packages like @runwars/shared
defaultConfig.watchFolders = [workspaceRoot];

defaultConfig.resolver.sourceExts.push("cjs");
defaultConfig.resolver.unstable_enablePackageExports = false;

// Explicitly resolve workspace packages to their real absolute paths
defaultConfig.resolver.extraNodeModules = {
  '@runwars/shared': path.resolve(workspaceRoot, 'packages/shared/src'),
};

module.exports = defaultConfig;
