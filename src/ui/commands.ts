import * as vscode from 'vscode';
import { Indexer } from '../indexer/indexer';
import { FileWatcher } from '../indexer/file-watcher';
import { Retriever } from '../retrieval/retriever';
import { ContextBuilder } from '../context/builder';
import { DashboardProvider } from './dashboard';
import { Logger } from '../utils/logger';

export function registerCommands(
  indexer: Indexer,
  fileWatcher: FileWatcher,
  retriever: Retriever,
  contextBuilder: ContextBuilder,
  dashboard: DashboardProvider,
  logger: Logger,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('pikr.search', () =>
      cmdSearch(retriever, contextBuilder, dashboard, logger),
    ),
    vscode.commands.registerCommand('pikr.reindex', () => cmdReindex(fileWatcher, dashboard, logger)),
    vscode.commands.registerCommand('pikr.setBudget', () => cmdSetBudget()),
    vscode.commands.registerCommand('pikr.openDashboard', () =>
      vscode.commands.executeCommand('pikr.dashboardView.focus'),
    ),
  ];
}

async function cmdSearch(
  retriever: Retriever,
  builder: ContextBuilder,
  dashboard: DashboardProvider,
  logger: Logger,
): Promise<void> {
  const query = await vscode.window.showInputBox({
    prompt: 'pikr: enter your query to retrieve relevant context',
    placeHolder: 'e.g. "authentication middleware"',
  });
  if (!query) return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'pikr: retrieving context...' },
    async () => {
      const chunks = await retriever.retrieve(query);
      const context = builder.build(chunks);

      const doc = await vscode.workspace.openTextDocument({
        content: context.text,
        language: 'typescript',
      });
      await vscode.window.showTextDocument(doc, { preview: true });

      dashboard.recordSearch(context.tokenCount);

      vscode.window.showInformationMessage(
        `pikr: ${context.chunkCount} chunks · ${context.tokenCount.toLocaleString()} tokens`,
      );
      logger.info(`Search "${query}" → ${context.chunkCount} chunks, ${context.tokenCount} tokens`);
    },
  );
}

async function cmdReindex(
  fileWatcher: FileWatcher,
  dashboard: DashboardProvider,
  logger: Logger,
): Promise<void> {
  logger.info('Manual reindex triggered');
  vscode.window.showInformationMessage('pikr: reindexing workspace...');
  fileWatcher.reindex();
  await dashboard.refresh();
}

async function cmdSetBudget(): Promise<void> {
  const current = vscode.workspace.getConfiguration('pikr').get<number>('tokenBudget', 4000);
  const input = await vscode.window.showInputBox({
    prompt: 'pikr: set token budget',
    value: String(current),
    validateInput: (v) => (isNaN(Number(v)) || Number(v) < 100 ? 'Must be a number ≥ 100' : null),
  });
  if (!input) return;
  await vscode.workspace.getConfiguration('pikr').update('tokenBudget', Number(input), true);
  vscode.window.showInformationMessage(`pikr: token budget set to ${input}`);
}
