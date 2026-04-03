import { estimateTokens } from '../tokens';
import { compressGeneric, CompressResult } from './generic';

/** git status — summarise by category */
function compressGitStatus(raw: string): CompressResult {
  const originalTokens = estimateTokens(raw);
  const lines = raw.split('\n');

  const staged: string[] = [];
  const modified: string[] = [];
  const untracked: string[] = [];
  const other: string[] = [];
  let inUntracked = false;

  for (const line of lines) {
    if (line.startsWith('Changes to be committed')) { inUntracked = false; continue; }
    if (line.startsWith('Changes not staged'))       { inUntracked = false; continue; }
    if (line.startsWith('Untracked files'))          { inUntracked = true;  continue; }
    if (line.trim() === '' || line.startsWith('#') || line.startsWith('On branch') ||
        line.startsWith('Your branch') || line.startsWith('nothing') ||
        line.startsWith('no changes') || line.startsWith('  (use')) {
      other.push(line);
      continue;
    }
    if (line.startsWith('\tmodified:') || line.startsWith('\tnew file:') ||
        line.startsWith('\tdeleted:')  || line.startsWith('\trenamed:')) {
      staged.push(line.trim());
    } else if (line.startsWith('\t') && !inUntracked) {
      modified.push(line.trim());
    } else if (inUntracked && line.startsWith('\t')) {
      untracked.push(line.trim());
    } else {
      other.push(line);
    }
  }

  const parts: string[] = [];

  // Keep branch/status lines
  const branchLines = lines.filter(l =>
    l.startsWith('On branch') || l.startsWith('Your branch') ||
    l.startsWith('nothing') || l.startsWith('no changes'));
  parts.push(...branchLines);

  if (staged.length)    parts.push(`\nStaged (${staged.length}):`,    ...staged.slice(0, 15),    staged.length > 15 ? `  ... +${staged.length - 15} more` : '');
  if (modified.length)  parts.push(`\nModified (${modified.length}):`, ...modified.slice(0, 15),  modified.length > 15 ? `  ... +${modified.length - 15} more` : '');
  if (untracked.length) parts.push(`\nUntracked (${untracked.length}):`, ...untracked.slice(0, 10), untracked.length > 10 ? `  ... +${untracked.length - 10} more` : '');

  if (!staged.length && !modified.length && !untracked.length) {
    parts.push(...other.filter(l => l.trim()));
  }

  const output = parts.filter(l => l !== '').join('\n').trim();
  return { output, originalTokens, savedTokens: Math.max(0, originalTokens - estimateTokens(output)) };
}

/** git diff — keep file headers + up to 3 hunks per file, truncate large hunks */
function compressGitDiff(raw: string): CompressResult {
  const originalTokens = estimateTokens(raw);
  if (!raw.trim()) return { output: raw, originalTokens, savedTokens: 0 };

  const MAX_HUNK_LINES = 40;
  const MAX_FILES = 20;

  const lines = raw.split('\n');
  const out: string[] = [];
  let hunkCount = 0;
  let hunkLines = 0;
  let fileCount = 0;
  let skippingHunk = false;

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      fileCount++;
      hunkCount = 0;
      if (fileCount > MAX_FILES) {
        out.push(`[... ${lines.length - out.length} more lines from ${fileCount - MAX_FILES}+ files omitted]`);
        break;
      }
      out.push(line);
      skippingHunk = false;
    } else if (line.startsWith('---') || line.startsWith('+++') ||
               line.startsWith('index ') || line.startsWith('new file') ||
               line.startsWith('deleted file') || line.startsWith('Binary')) {
      out.push(line);
    } else if (line.startsWith('@@')) {
      hunkCount++;
      hunkLines = 0;
      skippingHunk = hunkCount > 3;
      if (!skippingHunk) out.push(line);
    } else if (!skippingHunk) {
      hunkLines++;
      if (hunkLines <= MAX_HUNK_LINES) {
        out.push(line);
      } else if (hunkLines === MAX_HUNK_LINES + 1) {
        out.push('[... hunk truncated]');
      }
    }
  }

  // Append stat summary if present in original
  const statLines = raw.split('\n').filter(l => /^\d+ file/.test(l) || l.includes('insertion') || l.includes('deletion'));
  if (statLines.length) out.push('', ...statLines);

  const output = out.join('\n');
  return { output, originalTokens, savedTokens: Math.max(0, originalTokens - estimateTokens(output)) };
}

/** git log — compact format, max 25 entries */
function compressGitLog(raw: string): CompressResult {
  const originalTokens = estimateTokens(raw);
  const lines = raw.split('\n');
  const out: string[] = [];
  let commitCount = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('commit ')) {
      commitCount++;
      if (commitCount > 25) {
        out.push(`[... ${commitCount - 25}+ more commits omitted]`);
        break;
      }
      const hash = line.slice(7, 15); // first 8 chars
      let author = '';
      let date = '';
      let msg = '';

      // Peek ahead for author/date/message
      let j = i + 1;
      while (j < lines.length && !lines[j].startsWith('commit ')) {
        if (lines[j].startsWith('Author:')) author = lines[j].replace('Author:', '').trim().split('<')[0].trim();
        else if (lines[j].startsWith('Date:'))   date = lines[j].replace('Date:', '').trim();
        else if (lines[j].startsWith('Merge:'))  {}
        else if (lines[j].trim() && !msg)        msg = lines[j].trim();
        j++;
      }

      out.push(`${hash}  ${author}  ${date}`);
      if (msg) out.push(`  ${msg}`);
      i = j;
    } else {
      // Keep non-commit lines (e.g. already-compact --oneline format)
      if (line.trim()) out.push(line);
      i++;
    }
  }

  const output = out.join('\n').trim();
  return { output, originalTokens, savedTokens: Math.max(0, originalTokens - estimateTokens(output)) };
}

/** Route a git subcommand to the right compressor */
export function compressGit(subcommand: string, raw: string): CompressResult {
  const sub = subcommand.trim().toLowerCase();

  if (sub === 'status')       return compressGitStatus(raw);
  if (sub === 'diff'  || sub === 'show') return compressGitDiff(raw);
  if (sub === 'log')          return compressGitLog(raw);

  // add/commit/push/pull/fetch/merge — usually short, generic is fine
  return compressGeneric(raw);
}
