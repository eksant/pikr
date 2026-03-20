import * as fs from 'fs';
import * as path from 'path';
import { AstChunker } from '../chunker/ast-chunker';
import { TextChunker } from '../chunker/text-chunker';
import { Embedder } from '../embedder/embedder';
import { VectorStore } from '../store/vector-store';
import { ChunkRecord } from '../store/schema';
import { ILogger } from '../utils/logger';

export class Indexer {
  private readonly astChunker = new AstChunker();
  private readonly textChunker = new TextChunker();
  private readonly mtimeCache = new Map<string, number>();
  private readonly statePath: string;
  private pendingSave: NodeJS.Timeout | undefined;

  constructor(
    private readonly embedder: Embedder,
    private readonly store: VectorStore,
    private readonly logger: ILogger,
    storePath: string,
  ) {
    this.statePath = path.join(storePath, 'index-state.json');
    this.loadMtimeCache();
  }

  private loadMtimeCache(): void {
    try {
      const data = JSON.parse(fs.readFileSync(this.statePath, 'utf-8')) as Record<string, number>;
      for (const [k, v] of Object.entries(data)) {
        this.mtimeCache.set(k, v);
      }
      this.logger.info(`Loaded index state: ${this.mtimeCache.size} cached files`);
    } catch {
      // First run or corrupted cache — will rebuild
    }
  }

  private scheduleSave(): void {
    if (this.pendingSave) clearTimeout(this.pendingSave);
    this.pendingSave = setTimeout(() => {
      this.pendingSave = undefined;
      try {
        fs.writeFileSync(this.statePath, JSON.stringify(Object.fromEntries(this.mtimeCache)));
      } catch (err) {
        this.logger.error('Failed to save index state', err as Error);
      }
    }, 2000);
  }

  async indexFile(filePath: string): Promise<void> {
    const useAst = this.astChunker.canHandle(filePath);
    const useText = !useAst && this.textChunker.canHandle(filePath);
    if (!useAst && !useText) return;

    const stat = fs.statSync(filePath);
    if (this.mtimeCache.get(filePath) === stat.mtimeMs) return;

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
    this.mtimeCache.set(filePath, stat.mtimeMs);
    this.scheduleSave();
    this.logger.info(`Indexed ${chunks.length} chunks from ${filePath}`);
  }

  async removeFile(filePath: string): Promise<void> {
    await this.store.deleteByFile(filePath);
    this.mtimeCache.delete(filePath);
    this.scheduleSave();
    this.logger.info(`Removed chunks for ${filePath}`);
  }

  dispose(): void {
    if (this.pendingSave) {
      clearTimeout(this.pendingSave);
      try {
        fs.writeFileSync(this.statePath, JSON.stringify(Object.fromEntries(this.mtimeCache)));
      } catch {
        // best-effort flush on dispose
      }
    }
  }
}
