import { Embedder } from '../embedder/embedder';
import { VectorStore } from '../store/vector-store';
import { rerank, ScoredChunk } from './reranker';
import { ILogger } from '../utils/logger';

export class Retriever {
  constructor(
    private readonly embedder: Embedder,
    private readonly store: VectorStore,
    private readonly topK: number,
    private readonly logger: ILogger,
    private readonly getOpenFiles?: () => string[],
  ) {}

  async retrieve(query: string): Promise<ScoredChunk[]> {
    const queryVector = await this.embedder.embedOne(query);
    const candidates = await this.store.search(Array.from(queryVector), this.topK * 3);

    const openFilePaths = this.getOpenFiles?.() ?? [];

    const results = rerank(candidates, Array.from(queryVector), {
      openFilePaths,
      topK: this.topK,
    });

    this.logger.info(`Retrieved ${results.length} chunks for query`);
    return results;
  }
}
