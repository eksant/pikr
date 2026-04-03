import { runCompress } from './cli/compress';
import { runGain } from './cli/gain';
import { runInit } from './cli/init';

const [,, subcommand, ...rest] = process.argv;

switch (subcommand) {
  case 'compress':
    runCompress();
    break;
  case 'gain':
    runGain();
    break;
  case 'init':
    runInit(rest);
    break;
  default:
    console.log(`pikr CLI — shell output compressor

Usage:
  pikr init -g          Install hooks for Claude Code + Gemini CLI (global)
  pikr compress         Run command in PIKR_CMD env var and compress output
  pikr gain             Show token savings summary

Examples:
  pikr init -g
  PIKR_CMD="git status" node ~/.pikr/cli.js compress
  node ~/.pikr/cli.js gain
`);
    process.exit(subcommand ? 1 : 0);
}
