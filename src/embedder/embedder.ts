import * as fs from 'fs';
import { ModelManager } from './model-manager';
import { ILogger } from '../utils/logger';

type OrtSession = {
  run: (feeds: Record<string, OrtTensor>) => Promise<Record<string, OrtTensor>>;
};
type OrtTensor = {
  data: Float32Array | BigInt64Array;
  dims: number[];
};
type OrtLib = {
  InferenceSession: { create: (path: string) => Promise<OrtSession> };
  Tensor: new (type: string, data: number[] | BigInt64Array, dims: number[]) => OrtTensor;
};

const DIMS = 384;

export class Embedder {
  private session: OrtSession | undefined;
  private tokenizer: TokenizerFn | undefined;
  private loading: Promise<void> | undefined;

  constructor(
    private readonly modelManager: ModelManager,
    private readonly logger: ILogger,
  ) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    await this.ensureLoaded();
    return Promise.all(texts.map((t) => this.embedOne(t)));
  }

  async embedOne(text: string): Promise<Float32Array> {
    await this.ensureLoaded();
    const { inputIds, attentionMask, tokenTypeIds } = this.tokenizer!(text);

    const seq = inputIds.length;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ort = require('onnxruntime-node') as OrtLib;

    const feeds = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(inputIds.map(BigInt)), [1, seq]),
      attention_mask: new ort.Tensor('int64', BigInt64Array.from(attentionMask.map(BigInt)), [
        1,
        seq,
      ]),
      token_type_ids: new ort.Tensor('int64', BigInt64Array.from(tokenTypeIds.map(BigInt)), [
        1,
        seq,
      ]),
    };

    const output = await this.session!.run(feeds);
    const lastHidden = output['last_hidden_state'] ?? output[Object.keys(output)[0]];
    return meanPool(lastHidden.data as Float32Array, seq, DIMS);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.session) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      await this.modelManager.ensureModel();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ort = require('onnxruntime-node') as OrtLib;
      this.session = await ort.InferenceSession.create(this.modelManager.modelPath);
      this.tokenizer = buildTokenizer(this.modelManager.tokenizerPath);
      this.logger.info('Embedding model loaded');
    })();

    return this.loading;
  }
}

// Mean pooling over token dimension
function meanPool(data: Float32Array, seq: number, dims: number): Float32Array {
  const result = new Float32Array(dims);
  for (let d = 0; d < dims; d++) {
    let sum = 0;
    for (let s = 0; s < seq; s++) {
      sum += data[s * dims + d];
    }
    result[d] = sum / seq;
  }
  // L2 normalize
  let norm = 0;
  for (let d = 0; d < dims; d++) norm += result[d] * result[d];
  norm = Math.sqrt(norm);
  for (let d = 0; d < dims; d++) result[d] /= norm;
  return result;
}

type TokenizerFn = (text: string) => {
  inputIds: number[];
  attentionMask: number[];
  tokenTypeIds: number[];
};

function buildTokenizer(tokenizerPath: string): TokenizerFn {
  const tokenizerJson = JSON.parse(fs.readFileSync(tokenizerPath, 'utf-8'));
  const vocab: Record<string, number> = tokenizerJson.model?.vocab ?? {};

  // Minimal WordPiece tokenizer (sufficient for all-MiniLM-L6-v2)
  const clsId = vocab['[CLS]'] ?? 101;
  const sepId = vocab['[SEP]'] ?? 102;
  const unkId = vocab['[UNK]'] ?? 100;
  const maxLen = 128;

  return function tokenize(text: string) {
    // Simple whitespace + punctuation split, then wordpiece lookup
    const words = text.toLowerCase().split(/\s+/);
    const ids: number[] = [clsId];

    for (const word of words) {
      const wordIds = wordPieceEncode(word, vocab, unkId);
      ids.push(...wordIds);
      if (ids.length >= maxLen - 1) break;
    }
    ids.push(sepId);

    // Truncate to maxLen
    const truncated = ids.slice(0, maxLen);
    return {
      inputIds: truncated,
      attentionMask: truncated.map(() => 1),
      tokenTypeIds: truncated.map(() => 0),
    };
  };
}

function wordPieceEncode(word: string, vocab: Record<string, number>, unkId: number): number[] {
  const result: number[] = [];
  let start = 0;
  while (start < word.length) {
    let end = word.length;
    let found = false;
    while (start < end) {
      const substr = (start === 0 ? '' : '##') + word.slice(start, end);
      if (Object.prototype.hasOwnProperty.call(vocab, substr)) {
        result.push(vocab[substr]);
        start = end;
        found = true;
        break;
      }
      end--;
    }
    if (!found) {
      result.push(unkId);
      start++;
    }
  }
  return result.length ? result : [unkId];
}
