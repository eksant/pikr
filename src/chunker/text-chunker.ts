import * as path from 'path';
import * as crypto from 'crypto';
import { Chunk, ChunkKind } from './chunk';

// Max lines per chunk to avoid embedding huge blocks
const MAX_CHUNK_LINES = 120;

interface Pattern {
  re: RegExp;
  nameIdx: number;
  kind: ChunkKind;
}

interface LangConfig {
  langName: string;
  patterns: Pattern[];
}

function matchLine(line: string, patterns: Pattern[]): { name: string; kind: ChunkKind } | null {
  for (const { re, nameIdx, kind } of patterns) {
    const m = re.exec(line);
    if (m?.[nameIdx]) return { name: m[nameIdx], kind };
  }
  return null;
}

// One entry per file extension — patterns are tried in order, first match wins.
const LANG_CONFIGS: Record<string, LangConfig> = {
  '.py': {
    langName: 'python',
    patterns: [
      { re: /^\s*(?:async\s+)?def\s+(\w+)/, nameIdx: 1, kind: 'function' },
      { re: /^\s*class\s+(\w+)/, nameIdx: 1, kind: 'class' },
    ],
  },
  '.go': {
    langName: 'go',
    patterns: [
      // func Name( or func (recv Type) Name(
      { re: /^func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/, nameIdx: 1, kind: 'function' },
      { re: /^type\s+(\w+)\s+(?:struct|interface)/, nameIdx: 1, kind: 'class' },
    ],
  },
  '.rs': {
    langName: 'rust',
    patterns: [
      { re: /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/, nameIdx: 1, kind: 'function' },
      { re: /^(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum)\s+(\w+)/, nameIdx: 1, kind: 'class' },
      { re: /^(?:pub(?:\([^)]*\))?\s+)?trait\s+(\w+)/, nameIdx: 1, kind: 'interface' },
      // impl Type or impl Trait for Type — capture the rightmost type name
      { re: /^(?:pub(?:\([^)]*\))?\s+)?impl(?:\s+\w+(?:<[^>]*>)?\s+for)?\s+(\w+)/, nameIdx: 1, kind: 'class' },
    ],
  },
  '.php': {
    langName: 'php',
    patterns: [
      {
        re: /^\s*(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+(\w+)/,
        nameIdx: 1,
        kind: 'function',
      },
      { re: /^(?:abstract\s+)?class\s+(\w+)/, nameIdx: 1, kind: 'class' },
      { re: /^interface\s+(\w+)/, nameIdx: 1, kind: 'interface' },
    ],
  },
  '.rb': {
    langName: 'ruby',
    patterns: [
      { re: /^\s*def\s+(?:self\.)?(\w+)/, nameIdx: 1, kind: 'function' },
      { re: /^class\s+(\w+)/, nameIdx: 1, kind: 'class' },
      { re: /^module\s+(\w+)/, nameIdx: 1, kind: 'class' },
    ],
  },
  '.swift': {
    langName: 'swift',
    patterns: [
      {
        re: /^\s*(?:(?:public|private|internal|open|fileprivate|static|class|override|final|mutating|lazy)\s+)*func\s+(\w+)/,
        nameIdx: 1,
        kind: 'function',
      },
      {
        re: /^\s*(?:(?:public|private|internal|open|final)\s+)*(?:class|struct)\s+(\w+)/,
        nameIdx: 1,
        kind: 'class',
      },
      {
        re: /^\s*(?:(?:public|private|internal|open)\s+)*(?:enum|protocol)\s+(\w+)/,
        nameIdx: 1,
        kind: 'interface',
      },
    ],
  },
  '.kt': {
    langName: 'kotlin',
    patterns: [
      {
        re: /^\s*(?:(?:public|private|protected|internal|override|abstract|open|final|suspend|inline)\s+)*fun\s+(\w+)/,
        nameIdx: 1,
        kind: 'function',
      },
      {
        re: /^\s*(?:(?:public|private|internal|abstract|open|sealed|data)\s+)*class\s+(\w+)/,
        nameIdx: 1,
        kind: 'class',
      },
      {
        re: /^\s*(?:(?:public|private|internal)\s+)*(?:interface|object)\s+(\w+)/,
        nameIdx: 1,
        kind: 'interface',
      },
    ],
  },
  '.java': {
    langName: 'java',
    patterns: [
      // Requires at least one access modifier to avoid matching random expressions
      {
        re: /^\s*(?:(?:public|private|protected|static|final|synchronized|abstract|native|default)\s+)+(?:[\w<>\[\]]+\s+)+(\w+)\s*\(/,
        nameIdx: 1,
        kind: 'function',
      },
      {
        re: /^\s*(?:(?:public|private|protected|abstract|final|static)\s+)*class\s+(\w+)/,
        nameIdx: 1,
        kind: 'class',
      },
      {
        re: /^\s*(?:(?:public|private|protected)\s+)*interface\s+(\w+)/,
        nameIdx: 1,
        kind: 'interface',
      },
    ],
  },
  '.cs': {
    langName: 'csharp',
    patterns: [
      {
        re: /^\s*(?:(?:public|private|protected|internal|static|virtual|override|abstract|async|sealed|partial)\s+)+(?:[\w<>\[\]]+\s+)+(\w+)\s*\(/,
        nameIdx: 1,
        kind: 'function',
      },
      {
        re: /^\s*(?:(?:public|private|protected|internal|abstract|sealed|static|partial)\s+)*class\s+(\w+)/,
        nameIdx: 1,
        kind: 'class',
      },
      {
        re: /^\s*(?:(?:public|private|protected|internal)\s+)*interface\s+(\w+)/,
        nameIdx: 1,
        kind: 'interface',
      },
    ],
  },
};

export const TEXT_CHUNKER_EXTENSIONS = new Set(Object.keys(LANG_CONFIGS));

function chunkId(filePath: string, startLine: number): string {
  return crypto.createHash('sha1').update(`${filePath}:${startLine}`).digest('hex').slice(0, 16);
}

export class TextChunker {
  chunk(filePath: string, content: string, lastModified: number): Chunk[] {
    const ext = path.extname(filePath).toLowerCase();
    const config = LANG_CONFIGS[ext];
    if (!config) return [];

    const lines = content.split('\n');

    // Collect all chunk start positions
    const starts: { line: number; name: string; kind: ChunkKind }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = matchLine(lines[i], config.patterns);
      if (m) starts.push({ line: i, ...m });
    }

    const chunks: Chunk[] = [];
    for (let i = 0; i < starts.length; i++) {
      const startLine = starts[i].line;
      const endLine = (starts[i + 1]?.line ?? lines.length) - 1;
      // Cap text to avoid embedding huge chunks, but preserve endLine metadata
      const textEnd = Math.min(endLine, startLine + MAX_CHUNK_LINES - 1);
      const text = lines.slice(startLine, textEnd + 1).join('\n');

      chunks.push({
        id: chunkId(filePath, startLine),
        filePath,
        language: config.langName,
        kind: starts[i].kind,
        name: starts[i].name,
        text,
        startLine,
        endLine,
        lastModified,
      });
    }

    return chunks;
  }

  canHandle(filePath: string): boolean {
    return TEXT_CHUNKER_EXTENSIONS.has(path.extname(filePath).toLowerCase());
  }
}
