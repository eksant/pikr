import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { ILogger } from '../utils/logger';

const MODEL_FILENAME = 'all-MiniLM-L6-v2.onnx';
const TOKENIZER_FILENAME = 'tokenizer.json';

const MODEL_URL =
  'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx';
const TOKENIZER_URL =
  'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json';

export class ModelManager {
  private readonly modelsDir: string;
  private readonly inProgress = new Map<string, Promise<void>>();

  constructor(
    storePath: string,
    private readonly logger: ILogger,
  ) {
    this.modelsDir = path.join(storePath, 'models');
  }

  get modelPath(): string {
    return path.join(this.modelsDir, MODEL_FILENAME);
  }

  get tokenizerPath(): string {
    return path.join(this.modelsDir, TOKENIZER_FILENAME);
  }

  async ensureModel(onProgress?: (msg: string) => void): Promise<void> {
    fs.mkdirSync(this.modelsDir, { recursive: true });

    await Promise.all([
      this.download(MODEL_URL, this.modelPath, onProgress),
      this.download(TOKENIZER_URL, this.tokenizerPath, undefined),
    ]);
  }

  private async download(url: string, dest: string, onProgress?: (msg: string) => void): Promise<void> {
    if (fs.existsSync(dest)) return;

    // Deduplicate concurrent calls for the same file
    const existing = this.inProgress.get(dest);
    if (existing) return existing;

    const promise = this.doDownload(url, dest, onProgress).finally(() => this.inProgress.delete(dest));
    this.inProgress.set(dest, promise);
    return promise;
  }

  private async doDownload(url: string, dest: string, onProgress?: (msg: string) => void): Promise<void> {
    const name = path.basename(dest);
    this.logger.info(`Downloading ${name}...`);
    await new Promise<void>((resolve, reject) => {
      const tmp = dest + '.tmp';
      const file = fs.createWriteStream(tmp);

      const cleanup = (err?: Error) => {
        try { file.destroy(); } catch { /* ignore */ }
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* ignore */ }
        if (err) reject(err);
      };

      const req = https.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
          // Resolve any redirect URL (absolute, protocol-relative, or relative)
          const redirectUrl = new URL(res.headers.location, url).toString();
          this.doDownload(redirectUrl, dest, onProgress).then(resolve, reject);
          return;
        }

        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          cleanup(new Error(`Download failed: HTTP ${res.statusCode ?? 'unknown'} for ${name}`));
          return;
        }

        const total = parseInt(res.headers['content-length'] ?? '0', 10);
        let received = 0;

        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (total > 0 && onProgress) {
            const pct = Math.round((received / total) * 100);
            onProgress(`Downloading model... ${pct}%`);
          }
        });

        res.on('error', (err) => cleanup(err));

        res.pipe(file);
        file.on('finish', () => {
          file.close((closeErr) => {
            if (closeErr) { cleanup(closeErr); return; }
            try {
              fs.renameSync(tmp, dest);
              this.logger.info(`Downloaded ${name}`);
              resolve();
            } catch (err) {
              cleanup(err as Error);
            }
          });
        });
        file.on('error', (err) => cleanup(err));
      });

      // Abort if socket is idle for 60 seconds (stalled connection)
      req.setTimeout(60_000, () => {
        req.destroy(new Error(`Download timed out (no data for 60s): ${name}`));
      });

      req.on('error', (err) => cleanup(err));
    });
  }
}
