import { describe, it, expect } from 'vitest';
import { rerank } from '../retrieval/reranker';
import { ChunkRecord } from '../store/schema';

function vec(values: number[]): number[] {
  return values;
}

function makeChunk(
  id: string,
  vector: number[],
  overrides: Partial<ChunkRecord> = {},
): ChunkRecord {
  return {
    id,
    vector,
    filePath: '/src/file.ts',
    language: 'typescript',
    kind: 'function',
    name: id,
    text: `function ${id}() {}`,
    startLine: 0,
    endLine: 2,
    lastModified: Date.now(),
    ...overrides,
  };
}

describe('rerank', () => {
  it('returns at most topK results', () => {
    const query = vec([1, 0, 0, 0, 0, 0, 0, 0]);
    const chunks = Array.from({ length: 10 }, (_, i) =>
      makeChunk(`fn${i}`, vec([1, 0, 0, 0, 0, 0, 0, 0])),
    );
    const results = rerank(chunks, query, { openFilePaths: [], topK: 3 });
    expect(results).toHaveLength(3);
  });

  it('ranks chunk with higher cosine similarity first', () => {
    const query = vec([1, 0, 0, 0, 0, 0, 0, 0]);
    const close = makeChunk('close', vec([1, 0, 0, 0, 0, 0, 0, 0]));
    const far = makeChunk('far', vec([0, 0, 0, 0, 0, 0, 0, 1]));
    const results = rerank([far, close], query, { openFilePaths: [], topK: 2 });
    expect(results[0].chunk.id).toBe('close');
  });

  it('gives a proximity boost to chunks in open files', () => {
    const query = vec([1, 0, 0, 0, 0, 0, 0, 0]);
    // Same vector — only open-file proximity differentiates them
    const openChunk = makeChunk('open', vec([1, 0, 0, 0, 0, 0, 0, 0]), {
      filePath: '/src/open.ts',
    });
    const closedChunk = makeChunk('closed', vec([1, 0, 0, 0, 0, 0, 0, 0]), {
      filePath: '/src/closed.ts',
    });
    const results = rerank([closedChunk, openChunk], query, {
      openFilePaths: ['/src/open.ts'],
      topK: 2,
    });
    expect(results[0].chunk.id).toBe('open');
  });

  it('returns empty array when given empty input', () => {
    const results = rerank([], vec([1, 0, 0, 0, 0, 0, 0, 0]), { openFilePaths: [], topK: 5 });
    expect(results).toHaveLength(0);
  });

  it('all scores are between 0 and 1', () => {
    const query = vec([0.5, 0.5, 0, 0, 0, 0, 0, 0]);
    const chunks = [
      makeChunk('a', vec([1, 0, 0, 0, 0, 0, 0, 0])),
      makeChunk('b', vec([0, 1, 0, 0, 0, 0, 0, 0])),
    ];
    const results = rerank(chunks, query, { openFilePaths: [], topK: 10 });
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});
