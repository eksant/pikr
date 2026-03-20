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

Promise.all([extensionCtx, mcpCtx]).then(async ([ext, mcp]) => {
  if (watch) {
    await Promise.all([ext.watch(), mcp.watch()]);
    console.log('Watching...');
  } else {
    await Promise.all([ext.rebuild(), mcp.rebuild()]);
    await Promise.all([ext.dispose(), mcp.dispose()]);
  }
}).catch(() => process.exit(1));
