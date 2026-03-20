import * as vscode from 'vscode';
import { Indexer } from './indexer';
import { ILogger } from '../utils/logger';

// AST-chunked (pure-JS grammars): ts, tsx, js, jsx, mjs, cjs
// Text-chunked (regex fallback): py, go, rs, php, rb, swift, kt, java, cs
const FILE_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,rs,php,rb,swift,kt,java,cs}';
const IGNORE_PATTERNS = ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/out/**'];

export class FileWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | undefined;
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private readonly DEBOUNCE_MS = 500;

  constructor(
    private readonly indexer: Indexer,
    private readonly logger: ILogger,
  ) {}

  start(): void {
    this.watcher = vscode.workspace.createFileSystemWatcher(FILE_GLOB);

    this.watcher.onDidChange((uri) => this.schedule(uri.fsPath, 'change'));
    this.watcher.onDidCreate((uri) => this.schedule(uri.fsPath, 'create'));
    this.watcher.onDidDelete((uri) => this.scheduleDelete(uri.fsPath));

    // Defer initial indexing so extension activation returns immediately
    setTimeout(() => this.indexWorkspace(), 5000);
  }

  reindex(): void {
    this.logger.info('Manual reindex triggered');
    this.indexWorkspace();
  }

  private schedule(filePath: string, event: string): void {
    if (this.isIgnored(filePath)) return;

    // Debounce rapid saves
    const existing = this.pending.get(filePath);
    if (existing) clearTimeout(existing);

    this.pending.set(
      filePath,
      setTimeout(() => {
        this.pending.delete(filePath);
        this.indexer.indexFile(filePath).catch((err) => {
          this.logger.error(`Failed to index ${filePath} on ${event}`, err);
        });
      }, this.DEBOUNCE_MS),
    );
  }

  private scheduleDelete(filePath: string): void {
    if (this.isIgnored(filePath)) return;
    this.indexer.removeFile(filePath).catch((err) => {
      this.logger.error(`Failed to remove ${filePath}`, err);
    });
  }

  private async indexWorkspace(): Promise<void> {
    const uris = await vscode.workspace.findFiles(FILE_GLOB, `{${IGNORE_PATTERNS.join(',')}}`);
    this.logger.info(`Indexing ${uris.length} files...`);

    // Index in batches to avoid hammering the embedder
    const BATCH = 20;
    for (let i = 0; i < uris.length; i += BATCH) {
      const batch = uris.slice(i, i + BATCH);
      await Promise.all(
        batch.map((uri) =>
          this.indexer.indexFile(uri.fsPath).catch((err) => {
            this.logger.error(`Failed to index ${uri.fsPath}`, err);
          }),
        ),
      );
    }
    this.logger.info('Initial indexing complete');
  }

  private isIgnored(filePath: string): boolean {
    return IGNORE_PATTERNS.some((p) => {
      const pattern = p.replace(/\*\*/g, '').replace(/\*/g, '');
      return filePath.includes(pattern.replace(/\//g, ''));
    });
  }

  dispose(): void {
    this.watcher?.dispose();
    for (const t of this.pending.values()) clearTimeout(t);
  }
}
