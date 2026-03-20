#!/usr/bin/env node
/**
 * Platform-specific VSIX packager.
 * Temporarily removes other-platform native binaries before packaging,
 * then restores them. This drastically reduces VSIX size.
 *
 * Usage: node scripts/package-platform.js [darwin|linux|win32]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PLATFORM_TARGETS = {
  darwin: ['darwin-arm64', 'darwin-x64'],
  linux: ['linux-x64'],
  win32: ['win32-x64'],
};

const platform = process.argv[2] || process.platform;

if (!PLATFORM_TARGETS[platform]) {
  console.error(`Unknown platform: ${platform}. Use: darwin | linux | win32`);
  process.exit(1);
}

const onnxBinRoot = path.join(__dirname, '..', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6');
const allPlatforms = fs.readdirSync(onnxBinRoot).filter((d) => fs.statSync(path.join(onnxBinRoot, d)).isDirectory());
const toRemove = allPlatforms.filter((d) => d !== platform);

const tmpDir = path.join(require('os').tmpdir(), 'pikr-onnx-stash');
fs.mkdirSync(tmpDir, { recursive: true });

// Move other-platform dirs out temporarily
for (const dir of toRemove) {
  const src = path.join(onnxBinRoot, dir);
  const dst = path.join(tmpDir, dir);
  console.log(`Stashing ${dir}...`);
  fs.renameSync(src, dst);
}

try {
  for (const target of PLATFORM_TARGETS[platform]) {
    console.log(`\nPackaging for ${target}...`);
    execSync(`vsce package --target ${target}`, { stdio: 'inherit' });
  }
} finally {
  // Always restore
  for (const dir of toRemove) {
    const src = path.join(tmpDir, dir);
    const dst = path.join(onnxBinRoot, dir);
    console.log(`Restoring ${dir}...`);
    fs.renameSync(src, dst);
  }
  fs.rmSync(tmpDir, { recursive: true });
}

console.log('\nDone.');
