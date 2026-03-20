import * as vscode from 'vscode';

export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'pikr.search';
    this.item.text = '$(database) pikr';
    this.item.tooltip = 'pikr — click to search context';
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
