import * as fs from 'fs';
import { AstChunker } from '../chunker/ast-chunker';
import { TextChunker } from '../chunker/text-chunker';
import { Embedder } from '../embedder/embedder';
import { VectorStore } from '../store/vector-store';
import { ChunkRecord } from '../store/schema';
import { ILogger } from '../utils/logger';

export class Indexer {
  private readonly astChunker = new AstChunker();
  private readonly textChunker = new TextChunker();

  constructor(
    private readonly embedder: Embedder,
    private readonly store: VectorStore,
    private readonly logger: ILogger,
  ) {}

  async indexFile(filePath: string): Promise<void> {
    const useAst = this.astChunker.canHandle(filePath);
    const useText = !useAst && this.textChunker.canHandle(filePath);
    if (!useAst && !useText) return;

    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');

    const chunks = useAst
      ? await this.astChunker.chunk(filePath, content, stat.mtimeMs)
      : this.textChunker.chunk(filePath, content, stat.mtimeMs);
    if (!chunks.length) return;

    const vectors = await this.embedder.embed(chunks.map((c) => c.text));

    const records: ChunkRecord[] = chunks.map((chunk, i) => ({
      id: chunk.id,
      vector: Array.from(vectors[i]),
      filePath: chunk.filePath,
      language: chunk.language,
      kind: chunk.kind,
      name: chunk.name,
      text: chunk.text,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      lastModified: chunk.lastModified,
    }));

    await this.store.upsert(records);
    this.logger.info(`Indexed ${chunks.length} chunks from ${filePath}`);
  }

  async removeFile(filePath: string): Promise<void> {
    await this.store.deleteByFile(filePath);
    this.logger.info(`Removed chunks for ${filePath}`);
  }

  dispose(): void {
    // no-op — resources managed by embedder/store
  }
}
