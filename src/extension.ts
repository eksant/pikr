import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { Logger } from './utils/logger';
import { Indexer } from './indexer/indexer';
import { FileWatcher } from './indexer/file-watcher';
import { VectorStore } from './store/vector-store';
import { Embedder } from './embedder/embedder';
import { ModelManager } from './embedder/model-manager';
import { Retriever } from './retrieval/retriever';
import { ContextBuilder } from './context/builder';
import { DashboardProvider } from './ui/dashboard';
import { StatusBar } from './ui/statusbar';
import { registerCommands } from './ui/commands';

let indexer: Indexer | undefined;
let fileWatcher: FileWatcher | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = new Logger('pikr');
  logger.info('pikr activating...');

  const config = vscode.workspace.getConfiguration('pikr');

  const pikrRoot = path.join(os.homedir(), '.pikr');
  const workspacePath =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.globalStorageUri.fsPath;
  const wsHash = crypto.createHash('sha256').update(workspacePath).digest('hex').slice(0, 16);
  const storePath = path.join(pikrRoot, wsHash);

  const modelManager = new ModelManager(pikrRoot, logger);
  const embedder = new Embedder(modelManager, logger);
  const vectorStore = new VectorStore(storePath, logger);
  const retriever = new Retriever(embedder, vectorStore, config.get('topK', 20), logger, () =>
    vscode.window.visibleTextEditors.map((e) => e.document.uri.fsPath),
  );
  const contextBuilder = new ContextBuilder(config.get('tokenBudget', 4000));

  await vectorStore.open();

  indexer = new Indexer(embedder, vectorStore, logger, storePath);
  fileWatcher = new FileWatcher(indexer, logger);

  const dashboard = new DashboardProvider(vectorStore, logger, context.extensionPath);
  const statusBar = new StatusBar();

  const modelReady = fs.existsSync(modelManager.modelPath);
  if (modelReady) {
    dashboard.setModelStatus('ready');
  } else {
    dashboard.setModelStatus('loading');
    modelManager
      .ensureModel()
      .then(() => dashboard.setModelStatus('ready'))
      .catch((err: Error) => dashboard.setModelStatus('error', err.message));
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DashboardProvider.viewType, dashboard),
    statusBar,
    fileWatcher,
    ...registerCommands(indexer, fileWatcher, retriever, contextBuilder, dashboard, logger),
  );

  fileWatcher.start();

  logger.info('pikr activated');
}

export async function deactivate(): Promise<void> {
  fileWatcher?.dispose();
  indexer?.dispose();
}
