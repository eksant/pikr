import { readAnalytics } from './analytics';

/** Print token savings summary to stdout. */
export function runGain(): void {
  const stats = readAnalytics();

  if (stats.totalCommands === 0) {
    console.log('No tracking data yet.\nRun some commands through pikr to start tracking savings.');
    return;
  }

  const pct = stats.totalOriginalTokens > 0
    ? Math.round((stats.totalSavedTokens / stats.totalOriginalTokens) * 100)
    : 0;

  const bar = '█'.repeat(Math.round(pct / 4)) + '░'.repeat(25 - Math.round(pct / 4));

  console.log('\npikr Token Savings');
  console.log('═'.repeat(50));
  console.log(`Total commands:    ${stats.totalCommands}`);
  console.log(`Tokens saved:      ${fmt(stats.totalSavedTokens)} (${pct}%)`);
  console.log(`Original tokens:   ${fmt(stats.totalOriginalTokens)}`);
  console.log(`Efficiency:        ${bar} ${pct}%`);

  if (stats.byCommand.length) {
    console.log('\nBy Command');
    console.log('─'.repeat(50));
    console.log(`  ${'Command'.padEnd(28)} ${'Count'.padEnd(6)} ${'Saved'.padEnd(8)} Avg%`);
    console.log('─'.repeat(50));
    for (const entry of stats.byCommand.slice(0, 15)) {
      console.log(`  ${entry.cmd.padEnd(28)} ${String(entry.count).padEnd(6)} ${fmt(entry.saved).padEnd(8)} ${entry.pct}%`);
    }
    console.log('─'.repeat(50));
  }

  console.log('');
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}
