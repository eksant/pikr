import { describe, it, expect } from 'vitest';
import { ContextBuilder } from '../context/builder';
import { ScoredChunk } from '../retrieval/reranker';
import { ChunkRecord } from '../store/schema';

function makeChunk(overrides: Partial<ChunkRecord> = {}): ChunkRecord {
  return {
    id: 'test-id',
    vector: [],
    filePath: '/project/src/auth.ts',
    language: 'typescript',
    kind: 'function',
    name: 'authenticate',
    text: 'function authenticate(token: string) { return true; }',
    startLine: 10,
    endLine: 12,
    lastModified: Date.now(),
    ...overrides,
  };
}

function scored(chunk: ChunkRecord, score = 0.9): ScoredChunk {
  return { chunk, score };
}

describe('ContextBuilder', () => {
  it('includes chunks within token budget', () => {
    const builder = new ContextBuilder(4000);
    const chunks = [scored(makeChunk()), scored(makeChunk({ name: 'authorize', startLine: 20 }))];
    const result = builder.build(chunks);
    expect(result.chunkCount).toBe(2);
    expect(result.tokenCount).toBeGreaterThan(0);
    expect(result.tokenCount).toBeLessThanOrEqual(4000);
  });

  it('stops adding chunks when budget is exceeded', () => {
    // Budget of 1 token — nothing fits
    const builder = new ContextBuilder(1);
    const chunks = [scored(makeChunk())];
    const result = builder.build(chunks);
    expect(result.chunkCount).toBe(0);
    expect(result.tokenCount).toBe(0);
    expect(result.text).toBe('');
  });

  it('returns empty result for empty input', () => {
    const builder = new ContextBuilder(4000);
    const result = builder.build([]);
    expect(result.chunkCount).toBe(0);
    expect(result.tokenCount).toBe(0);
    expect(result.text).toBe('');
  });

  it('formats output with file path and chunk metadata header', () => {
    const builder = new ContextBuilder(4000);
    const chunk = makeChunk({ filePath: '/src/auth.ts', startLine: 5, kind: 'function', name: 'login' });
    const result = builder.build([scored(chunk)]);
    expect(result.text).toContain('/src/auth.ts:5');
    expect(result.text).toContain('[function]');
    expect(result.text).toContain('login');
  });

  it('calculates savedTokens relative to totalCodebaseTokens', () => {
    const builder = new ContextBuilder(4000);
    const chunks = [scored(makeChunk())];
    const result = builder.build(chunks, 100_000);
    expect(result.savedTokens).toBe(100_000 - result.tokenCount);
  });

  it('savedTokens is 0 when totalCodebaseTokens not provided', () => {
    const builder = new ContextBuilder(4000);
    const result = builder.build([scored(makeChunk())]);
    expect(result.savedTokens).toBe(0);
  });
});
