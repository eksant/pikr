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

  async ensureModel(): Promise<void> {
    fs.mkdirSync(this.modelsDir, { recursive: true });

    await Promise.all([
      this.download(MODEL_URL, this.modelPath),
      this.download(TOKENIZER_URL, this.tokenizerPath),
    ]);
  }

  private async download(url: string, dest: string): Promise<void> {
    if (fs.existsSync(dest)) return;

    // Deduplicate concurrent calls for the same file
    const existing = this.inProgress.get(dest);
    if (existing) return existing;

    const promise = this.doDownload(url, dest).finally(() => this.inProgress.delete(dest));
    this.inProgress.set(dest, promise);
    return promise;
  }

  private async doDownload(url: string, dest: string): Promise<void> {
    this.logger.info(`Downloading ${path.basename(dest)}...`);
    await new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(dest + '.tmp');
      https
        .get(url, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            file.close();
            if (fs.existsSync(dest + '.tmp')) fs.unlinkSync(dest + '.tmp');
            // Resolve any redirect URL (absolute, protocol-relative, or relative)
            const redirectUrl = new URL(res.headers.location, url).toString();
            this.doDownload(redirectUrl, dest).then(resolve, reject);
            return;
          }
          res.pipe(file);
          file.on('finish', () => {
            file.close();
            fs.renameSync(dest + '.tmp', dest);
            this.logger.info(`Downloaded ${path.basename(dest)}`);
            resolve();
          });
        })
        .on('error', (err) => {
          if (fs.existsSync(dest + '.tmp')) fs.unlinkSync(dest + '.tmp');
          reject(err);
        });
    });
  }
}
