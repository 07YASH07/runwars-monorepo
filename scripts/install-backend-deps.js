#!/usr/bin/env node
/**
 * Installs the backend's dependencies from the root package-lock.json before
 * the backend build on Render (wired as the `prebuild` script of
 * apps/backend, so it runs however Render invokes the backend build).
 *
 * Why: the Render build stopped installing dependencies (commit e3b93e9) and
 * relied on a node_modules restored from Render's build cache. Dependencies
 * added later (firebase-admin) were never installed, so `tsc` failed with
 * TS2307. This script does a reproducible `npm ci` limited to the shared and
 * backend workspaces, so the mobile/admin toolchains are not installed on the
 * server.
 *
 * Locally (no RENDER / CI env var) it does nothing, so `npm run build:backend`
 * on a developer machine never wipes node_modules. Set
 * FORCE_BACKEND_CLEAN_INSTALL=1 to run it locally on purpose.
 */
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const onBuildServer = !!(process.env.RENDER || process.env.CI || process.env.FORCE_BACKEND_CLEAN_INSTALL === '1');

if (!onBuildServer) {
  try {
    require.resolve('firebase-admin', { paths: [path.join(root, 'apps', 'backend')] });
  } catch {
    console.error('[install-backend-deps] firebase-admin is not installed. Run `npm install` at the repository root.');
    process.exit(1);
  }
  console.log('[install-backend-deps] Local build: skipping clean install (dependencies present).');
  process.exit(0);
}

// Runs from both the root build:backend script and the backend prebuild hook;
// a marker holding the lockfile hash makes the second call (and later builds
// that restore an up-to-date node_modules from cache) a no-op.
const lockHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'package-lock.json'))).digest('hex');
const marker = path.join(root, 'node_modules', '.backend-deps-lock-hash');
if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === lockHash) {
  console.log('[install-backend-deps] Dependencies already match package-lock.json; skipping install.');
  process.exit(0);
}

const cmd = 'npm ci --include=dev --no-audit --no-fund --workspace=@runwars/shared --workspace=@runwars/backend';
console.log(`[install-backend-deps] ${cmd}`);
execSync(cmd, { cwd: root, stdio: 'inherit' });
fs.writeFileSync(marker, lockHash + '\n');
