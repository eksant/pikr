const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

const nativeModules = [
  'onnxruntime-node',
  '@lancedb/lancedb',
  'tree-sitter',
  'tree-sitter-typescript',
  'tree-sitter-javascript',
];

const extensionCtx = esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode', ...nativeModules],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: watch,
  minify: !watch,
  logLevel: 'info',
});

const mcpCtx = esbuild.context({
  entryPoints: ['src/mcp/server.ts'],
  bundle: true,
  outfile: 'dist/mcp.js',
  external: ['vscode', ...nativeModules],
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: watch,
  minify: !watch,
  logLevel: 'info',
});

const cliCtx = esbuild.context({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  outfile: 'dist/cli.js',
  external: [],  // fully self-contained — no native modules needed
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: watch,
  minify: !watch,
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
});

const fs = require('fs');

Promise.all([extensionCtx, mcpCtx, cliCtx]).then(async ([ext, mcp, cli]) => {
  if (watch) {
    await Promise.all([ext.watch(), mcp.watch(), cli.watch()]);
    console.log('Watching...');
  } else {
    await Promise.all([ext.rebuild(), mcp.rebuild(), cli.rebuild()]);
    fs.chmodSync('dist/cli.js', 0o755);
    await Promise.all([ext.dispose(), mcp.dispose(), cli.dispose()]);
  }
}).catch(() => process.exit(1));
