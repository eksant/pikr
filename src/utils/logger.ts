export interface ILogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string, err?: unknown): void;
}

export class Logger implements ILogger {
  private readonly channel: { appendLine: (s: string) => void; dispose: () => void };

  constructor(name: string) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vscode = require('vscode');
    this.channel = vscode.window.createOutputChannel(name);
  }

  info(msg: string): void {
    this.channel.appendLine(`[INFO]  ${msg}`);
  }

  warn(msg: string): void {
    this.channel.appendLine(`[WARN]  ${msg}`);
  }

  error(msg: string, err?: unknown): void {
    const detail = err instanceof Error ? ` — ${err.message}` : '';
    this.channel.appendLine(`[ERROR] ${msg}${detail}`);
  }

  dispose(): void {
    this.channel.dispose();
  }
}

export class ConsoleLogger implements ILogger {
  info(msg: string): void {
    process.stderr.write(`[INFO]  ${msg}\n`);
  }

  warn(msg: string): void {
    process.stderr.write(`[WARN]  ${msg}\n`);
  }

  error(msg: string, err?: unknown): void {
    const detail = err instanceof Error ? ` — ${err.message}` : '';
    process.stderr.write(`[ERROR] ${msg}${detail}\n`);
  }
}
