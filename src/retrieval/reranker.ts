import { ChunkRecord } from '../store/schema';

export interface ScoredChunk {
  chunk: ChunkRecord;
  score: number;
}

interface RerankOptions {
  openFilePaths: string[];
  topK: number;
}

export function rerank(
  chunks: ChunkRecord[],
  queryVector: number[],
  opts: RerankOptions,
): ScoredChunk[] {
  const now = Date.now();
  const openSet = new Set(opts.openFilePaths);

  const scored: ScoredChunk[] = chunks.map((chunk) => {
    const similarity = cosineSimilarity(queryVector, chunk.vector);

    // Recency boost: decay over 7 days
    const ageDays = (now - chunk.lastModified) / (1000 * 60 * 60 * 24);
    const recency = Math.exp(-ageDays / 7);

    // Proximity boost: currently open files score higher
    const proximity = openSet.has(chunk.filePath) ? 0.2 : 0;

    const score = similarity * 0.7 + recency * 0.15 + proximity * 0.15;
    return { chunk, score };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, opts.topK);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}
