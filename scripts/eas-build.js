#!/usr/bin/env node

// Wraps `eas build` so every build leaves a record behind in release/ --
// version, git commit, platform/profile, and whether the working tree was
// clean at build time. EAS Build itself runs in Expo's cloud and only
// hands back a download link, it doesn't write anything to your machine,
// so this is what "every time I build" actually gets automated as: a
// local paper trail, not the binary itself.
//
// Usage (same flags you'd pass eas build directly):
//   npm run build -- --platform android --profile production
//   npm run build -- --platform ios --profile preview
//
// Safe to re-run -- each build gets its own timestamped file, nothing is
// overwritten.

const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);

function getFlag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

function git(cmdArgs, fallback = '') {
  try {
    return execFileSync('git', cmdArgs, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

const platform = getFlag('platform', 'all');
const profile = getFlag('profile', 'production');

const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).expo;
const version = appJson?.version || 'unknown';
const iosBuildNumber = appJson?.ios?.buildNumber;
const androidVersionCode = appJson?.android?.versionCode;

const commit = git(['rev-parse', '--short', 'HEAD'], 'unknown');
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown');
const isDirty = git(['status', '--porcelain']).length > 0;

const now = new Date();
const stamp = now.toISOString().replace(/[:.]/g, '-');

const releaseDir = path.join(ROOT, 'release');
fs.mkdirSync(releaseDir, { recursive: true });

const filePath = path.join(releaseDir, `${version}_${platform}_${profile}_${stamp}.md`);

const lines = [
  `# ${version} -- ${platform}/${profile}`,
  '',
  `- Date: ${now.toString()}`,
  `- Version: ${version}`,
  iosBuildNumber ? `- iOS build number: ${iosBuildNumber}` : null,
  androidVersionCode ? `- Android version code: ${androidVersionCode}` : null,
  `- Platform: ${platform}`,
  `- Profile: ${profile}`,
  `- Git branch: ${branch}`,
  `- Git commit: ${commit}${isDirty ? ' (dirty -- uncommitted changes were included in this build)' : ''}`,
  `- Command: eas build ${args.join(' ')}`,
  '',
  '## Status',
  '',
  '_pending -- eas build is still running_',
  '',
].filter((l) => l !== null);

fs.writeFileSync(filePath, lines.join('\n'));
console.log(`Release notes: ${path.relative(ROOT, filePath)}`);

const result = spawnSync('eas', ['build', ...args], { stdio: 'inherit', cwd: ROOT });
const code = result.status ?? 1;

const status = code === 0
  ? 'Build finished (exit code 0). Run `eas build:list` or check https://expo.dev for the download link.'
  : `eas build exited with code ${code} -- see the terminal output above.`;

const written = fs.readFileSync(filePath, 'utf8');
fs.writeFileSync(filePath, written.replace('_pending -- eas build is still running_', status));

process.exit(code);
