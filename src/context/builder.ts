import { ScoredChunk } from '../retrieval/reranker';
import { countTokens } from '../utils/tokenizer';

export interface BuiltContext {
  text: string;
  tokenCount: number;
  chunkCount: number;
  savedTokens: number;
}

export class ContextBuilder {
  constructor(private readonly tokenBudget: number) {}

  build(chunks: ScoredChunk[], totalCodebaseTokens = 0): BuiltContext {
    const parts: string[] = [];
    let tokenCount = 0;

    for (const { chunk } of chunks) {
      const header = `// ${chunk.filePath}:${chunk.startLine} [${chunk.kind}] ${chunk.name}\n`;
      const block = header + chunk.text + '\n\n';
      const blockTokens = countTokens(block);

      if (tokenCount + blockTokens > this.tokenBudget) break;

      parts.push(block);
      tokenCount += blockTokens;
    }

    return {
      text: parts.join(''),
      tokenCount,
      chunkCount: parts.length,
      savedTokens: Math.max(0, totalCodebaseTokens - tokenCount),
    };
  }
}
