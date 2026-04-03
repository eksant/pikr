import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface AnalyticsRecord {
  ts: number;
  cmd: string;
  originalTokens: number;
  savedTokens: number;
}

export interface AnalyticsSummary {
  totalCommands: number;
  totalOriginalTokens: number;
  totalSavedTokens: number;
  byCommand: { cmd: string; count: number; saved: number; pct: number }[];
}

function analyticsPath(): string {
  return path.join(os.homedir(), '.pikr', 'analytics.ndjson');
}

/** Append a single record (sync, atomic for small writes). */
export function appendAnalytics(record: AnalyticsRecord): void {
  try {
    const line = JSON.stringify(record) + '\n';
    fs.mkdirSync(path.dirname(analyticsPath()), { recursive: true });
    fs.appendFileSync(analyticsPath(), line, 'utf8');
  } catch {
    // Best-effort — never crash the CLI over analytics
  }
}

/** Read and aggregate all analytics records. */
export function readAnalytics(): AnalyticsSummary {
  const filePath = analyticsPath();
  if (!fs.existsSync(filePath)) {
    return { totalCommands: 0, totalOriginalTokens: 0, totalSavedTokens: 0, byCommand: [] };
  }

  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  const records: AnalyticsRecord[] = [];
  for (const line of lines) {
    try { records.push(JSON.parse(line) as AnalyticsRecord); } catch { /* skip corrupt lines */ }
  }

  const cmdMap = new Map<string, { count: number; saved: number; orig: number }>();
  let totalOriginal = 0;
  let totalSaved = 0;

  for (const r of records) {
    totalOriginal += r.originalTokens;
    totalSaved += r.savedTokens;
    const key = r.cmd.split(' ').slice(0, 2).join(' '); // e.g. "git status" → "git status"
    const entry = cmdMap.get(key) ?? { count: 0, saved: 0, orig: 0 };
    entry.count++;
    entry.saved += r.savedTokens;
    entry.orig += r.originalTokens;
    cmdMap.set(key, entry);
  }

  const byCommand = Array.from(cmdMap.entries())
    .map(([cmd, e]) => ({
      cmd,
      count: e.count,
      saved: e.saved,
      pct: e.orig > 0 ? Math.round((e.saved / e.orig) * 100) : 0,
    }))
    .sort((a, b) => b.saved - a.saved);

  return {
    totalCommands: records.length,
    totalOriginalTokens: totalOriginal,
    totalSavedTokens: totalSaved,
    byCommand,
  };
}
