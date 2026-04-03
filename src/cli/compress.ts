import { spawnSync } from 'child_process';
import { compress } from './compressors/index';
import { appendAnalytics } from './analytics';

/**
 * Run a shell command, compress its output, and print to stdout.
 * Called via: PIKR_CMD="git status" node cli.js compress
 */
export function runCompress(): void {
  const originalCmd = process.env['PIKR_CMD'];
  if (!originalCmd) {
    process.stderr.write('[pikr] PIKR_CMD env var not set\n');
    process.exit(1);
  }

  const result = spawnSync('/bin/sh', ['-c', originalCmd], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
    maxBuffer: 10 * 1024 * 1024,
  });

  const rawOutput = [
    result.stdout ?? '',
    result.stderr ? result.stderr : '',
  ].filter(Boolean).join('\n');

  const { output, originalTokens, savedTokens } = compress(originalCmd, rawOutput);

  process.stdout.write(output);
  if (!output.endsWith('\n')) process.stdout.write('\n');

  // Persist analytics (sync, small write — negligible latency)
  if (savedTokens > 0) {
    appendAnalytics({
      ts: Date.now(),
      cmd: originalCmd,
      originalTokens,
      savedTokens,
    });
  }

  process.exit(result.status ?? 0);
}
