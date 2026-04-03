import { estimateTokens } from '../tokens';
import { CompressResult } from './generic';

/** Test output compressor — keep failures + summary, strip pass noise */
export function compressTestOutput(raw: string): CompressResult {
  const originalTokens = estimateTokens(raw);
  const lines = raw.split('\n');

  // Detect failure markers
  const hasFailures =
    lines.some(l => /\b(FAIL|FAILED|failing|failed|ERROR|error)\b/.test(l)) ||
    lines.some(l => /×|✕|✗|●\s/.test(l)) ||
    lines.some(l => /\d+\s+failed/.test(l));

  // Extract summary line(s) — always keep these
  const summaryLines = lines.filter(l =>
    /Tests?:\s*\d+/.test(l) ||
    /Suites?:\s*\d+/.test(l) ||
    /passed|failed|skipped|todo/.test(l.toLowerCase()) && /\d+/.test(l) ||
    /test suites?.*\d+/i.test(l) ||
    /Duration|Time:/.test(l)
  );

  if (!hasFailures) {
    // All passing — emit only summary
    const summarySection = summaryLines.length
      ? summaryLines.join('\n')
      : lines.filter(l => l.trim()).slice(-3).join('\n');

    const output = `[All tests passed]\n${summarySection}`;
    return { output, originalTokens, savedTokens: Math.max(0, originalTokens - estimateTokens(output)) };
  }

  // Has failures — extract only failing blocks
  const out: string[] = ['[Test failures detected]', ''];
  let inFailBlock = false;
  let failBlockLines = 0;
  const MAX_FAIL_BLOCK = 30;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Start of a failure block (jest/vitest style)
    if (/●\s+/.test(line) || /FAIL\s/.test(line) || /^\s*✕|×/.test(line)) {
      inFailBlock = true;
      failBlockLines = 0;
      out.push(line);
      continue;
    }

    // End of a failure block — summary or next test
    if (inFailBlock && (
      /^─{10}|^={10}/.test(line) ||
      /Tests?:\s*\d+/.test(line) ||
      failBlockLines > MAX_FAIL_BLOCK
    )) {
      inFailBlock = false;
      out.push('');
    }

    if (inFailBlock) {
      // Skip deep stack frames in node_modules
      if (/node_modules/.test(line) && /at /.test(line)) {
        failBlockLines++;
        continue;
      }
      out.push(line);
      failBlockLines++;
    }
  }

  // Always append summary
  if (summaryLines.length) {
    out.push('', ...summaryLines);
  }

  const output = out.join('\n').trim();
  return { output, originalTokens, savedTokens: Math.max(0, originalTokens - estimateTokens(output)) };
}
