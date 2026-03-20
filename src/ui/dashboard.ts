import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VectorStore } from '../store/vector-store';
import { ChunkRecord } from '../store/schema';
import { ILogger } from '../utils/logger';

type McpStatus = 'configured' | 'not-configured' | 'unknown';

export class DashboardProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'pikr.dashboardView';

  private view?: vscode.WebviewView;
  private queriesServed = 0;
  private tokensServed = 0;
  private modelStatus: 'loading' | 'ready' | 'error' = 'loading';
  private modelMessage = '';
  private indexingProgress: { current: number; total: number } | null = null;

  constructor(
    private readonly store: VectorStore,
    private readonly logger: ILogger,
    private readonly extensionPath: string,
  ) {}

  private get mcpServerPath(): string {
    return path.join(this.extensionPath, 'dist', 'mcp.js');
  }

  private detectMcpStatus(): McpStatus {
    try {
      const claudeJson = path.join(os.homedir(), '.claude.json');
      if (!fs.existsSync(claudeJson)) return 'not-configured';
      const data = JSON.parse(fs.readFileSync(claudeJson, 'utf8')) as Record<string, unknown>;
      const servers = data['mcpServers'] as Record<string, unknown> | undefined;
      return servers?.['pikr'] ? 'configured' : 'not-configured';
    } catch {
      return 'unknown';
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.html();

    webviewView.webview.onDidReceiveMessage(
      async (msg: { type: string; value?: unknown; filePath?: string }) => {
        switch (msg.type) {
          case 'ready':
            await this.pushAll();
            break;
          case 'updateBudget': {
            const v = Number(msg.value);
            if (!isNaN(v) && v >= 100) {
              await vscode.workspace.getConfiguration('pikr').update('tokenBudget', v, true);
              vscode.window.showInformationMessage(`pikr: token budget set to ${v}`);
            }
            break;
          }
          case 'updateTopK': {
            const v = Number(msg.value);
            if (!isNaN(v) && v >= 1) {
              await vscode.workspace.getConfiguration('pikr').update('topK', v, true);
              vscode.window.showInformationMessage(`pikr: top-K set to ${v}`);
            }
            break;
          }
          case 'reindex':
            await vscode.commands.executeCommand('pikr.reindex');
            break;
          case 'search':
            await vscode.commands.executeCommand('pikr.search');
            break;
          case 'openFile':
            if (msg.filePath) {
              await vscode.window.showTextDocument(vscode.Uri.file(msg.filePath));
            }
            break;
          case 'setupMcp': {
            const cmd = `claude mcp add -s user pikr -- node "${this.mcpServerPath}"`;
            const terminal = vscode.window.createTerminal('pikr MCP setup');
            terminal.show();
            terminal.sendText(cmd);
            // Give the terminal a moment to run, then refresh status
            setTimeout(() => void this.pushMcpInfo(), 3000);
            break;
          }
          case 'refreshMcpStatus':
            await this.pushMcpInfo();
            break;
        }
      },
    );
  }

  setIndexingProgress(current: number, total: number): void {
    this.indexingProgress = current >= total ? null : { current, total };
    void this.pushStats();
  }

  setModelStatus(status: 'loading' | 'ready' | 'error', message = ''): void {
    this.modelStatus = status;
    this.modelMessage = message;
    void this.pushStats();
  }

  recordSearch(tokenCount: number): void {
    this.queriesServed++;
    this.tokensServed += tokenCount;
    void this.pushStats();
  }

  async refresh(): Promise<void> {
    await this.pushAll();
  }

  private async pushAll(): Promise<void> {
    await Promise.all([this.pushStats(), this.pushConfig(), this.pushIndex(), this.pushMcpInfo()]);
  }

  private async pushMcpInfo(): Promise<void> {
    if (!this.view) return;
    this.view.webview.postMessage({
      type: 'mcpInfo',
      status: this.detectMcpStatus(),
      serverPath: this.mcpServerPath,
    });
  }

  private async pushStats(): Promise<void> {
    if (!this.view) return;
    const [chunkCount, files] = await Promise.all([
      this.store.count().catch(() => 0),
      this.getFileList(),
    ]);
    this.view.webview.postMessage({
      type: 'stats',
      fileCount: files.length,
      chunkCount,
      queriesServed: this.queriesServed,
      tokensServed: this.tokensServed,
      modelStatus: this.modelStatus,
      modelMessage: this.modelMessage,
      indexingProgress: this.indexingProgress,
    });
  }

  private async pushConfig(): Promise<void> {
    if (!this.view) return;
    const cfg = vscode.workspace.getConfiguration('pikr');
    this.view.webview.postMessage({
      type: 'config',
      tokenBudget: cfg.get<number>('tokenBudget', 4000),
      topK: cfg.get<number>('topK', 20),
    });
  }

  private async pushIndex(): Promise<void> {
    if (!this.view) return;
    const files = await this.getFileList();
    this.view.webview.postMessage({ type: 'index', files });
  }

  private async getFileList(): Promise<{ filePath: string; chunkCount: number }[]> {
    const zero = new Array(384).fill(0);
    const all = await this.store.search(zero, 10_000).catch(() => [] as ChunkRecord[]);
    const map = new Map<string, number>();
    for (const r of all) {
      map.set(r.filePath, (map.get(r.filePath) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([filePath, chunkCount]) => ({ filePath, chunkCount }));
  }

  private html(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
}
.tabs {
  display: flex;
  background: var(--vscode-sideBarSectionHeader-background, var(--vscode-editor-background));
  border-bottom: 1px solid var(--vscode-panel-border);
  position: sticky;
  top: 0;
  z-index: 1;
}
.tab {
  flex: 1;
  padding: 8px 4px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--vscode-tab-inactiveForeground, var(--vscode-descriptionForeground));
  cursor: pointer;
  font-size: 11px;
  font-family: var(--vscode-font-family);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.tab:hover { color: var(--vscode-foreground); }
.tab.active {
  color: var(--vscode-foreground);
  border-bottom-color: var(--vscode-focusBorder);
}
.panel { display: none; padding: 12px; }
.panel.active { display: block; }

/* Model status */
.model-badge {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 10px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  margin-bottom: 12px;
  font-size: 12px;
}
.dot {
  width: 8px; height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot.ready { background: #4ec94e; }
.dot.loading { background: #e8a630; animation: pulse 1.2s ease-in-out infinite; }
.dot.error { background: var(--vscode-errorForeground, #f44); }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

/* Indexing progress */
.indexing-progress {
  margin-bottom: 12px;
}
.indexing-label {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 4px;
}
.progress-track {
  height: 3px;
  background: var(--vscode-panel-border);
  border-radius: 2px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--vscode-focusBorder);
  border-radius: 2px;
  transition: width 0.3s ease;
}

/* Stat cards */
.cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 12px;
}
.card {
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 4px;
  padding: 10px;
}
.card-value {
  font-size: 20px;
  font-weight: 600;
  line-height: 1;
  margin-bottom: 4px;
}
.card-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vscode-descriptionForeground);
}

/* Buttons */
.btn-row { display: flex; gap: 6px; }
.btn {
  padding: 5px 12px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  border-radius: 2px;
  cursor: pointer;
  font-size: 12px;
  font-family: var(--vscode-font-family);
}
.btn:hover { background: var(--vscode-button-hoverBackground); }
.btn-sec {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}
.btn-sec:hover { background: var(--vscode-button-secondaryHoverBackground); }

/* Settings form */
.field { margin-bottom: 14px; }
.field label {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 5px;
}
.field input {
  width: 100%;
  padding: 5px 8px;
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, transparent);
  border-radius: 2px;
  font-size: 13px;
  font-family: var(--vscode-font-family);
}
.field input:focus {
  outline: 1px solid var(--vscode-focusBorder);
  border-color: var(--vscode-focusBorder);
}
.hint {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  margin-top: 4px;
}

/* Index list */
.section-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 8px;
}
.file-list { list-style: none; }
.file-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 3px;
  cursor: pointer;
}
.file-item:hover { background: var(--vscode-list-hoverBackground); }
.file-name {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.badge {
  font-size: 10px;
  padding: 1px 5px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 8px;
  flex-shrink: 0;
}
.empty {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  text-align: center;
  padding: 20px 0;
}

/* About / onboarding */
.divider {
  border: none;
  border-top: 1px solid var(--vscode-panel-border);
  margin: 14px 0;
}
.about-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 6px;
}
.about-desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--vscode-foreground);
  margin-bottom: 10px;
}
.steps { display: flex; flex-direction: column; gap: 7px; margin-bottom: 10px; }
.step {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  line-height: 1.4;
}
.step-num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  margin-top: 1px;
}

/* First-run card */
.get-started {
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-focusBorder);
  border-radius: 4px;
  padding: 10px 12px;
  margin-top: 14px;
}
.gs-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vscode-focusBorder);
  margin-bottom: 8px;
}
.gs-step {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  line-height: 1.5;
  margin-bottom: 8px;
}
.gs-num {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--vscode-focusBorder);
  color: var(--vscode-button-foreground, #fff);
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
  margin-top: 2px;
}

/* MCP tab */
.mcp-status-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.mcp-status-badge {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 10px;
  font-weight: 600;
}
.mcp-status-badge.configured {
  background: #1a3a1a;
  color: #4ec94e;
}
.mcp-status-badge.not-configured {
  background: var(--vscode-editor-background);
  color: var(--vscode-descriptionForeground);
  border: 1px solid var(--vscode-panel-border);
}
.mcp-section { margin-bottom: 16px; }
.mcp-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vscode-descriptionForeground);
  margin-bottom: 6px;
}
.mcp-desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--vscode-foreground);
  margin-bottom: 8px;
}
.mcp-code-wrap {
  position: relative;
  margin-bottom: 8px;
}
.mcp-code {
  display: block;
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: 11px;
  background: var(--vscode-textCodeBlock-background, #1e1e1e);
  color: var(--vscode-textPreformat-foreground, #d4d4d4);
  padding: 7px 36px 7px 8px;
  border-radius: 3px;
  word-break: break-all;
  white-space: pre-wrap;
}
.btn-copy {
  position: absolute;
  top: 4px;
  right: 4px;
  padding: 2px 6px;
  font-size: 10px;
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border: none;
  border-radius: 2px;
  cursor: pointer;
  font-family: var(--vscode-font-family);
}
.btn-copy:hover { background: var(--vscode-button-secondaryHoverBackground); }
.mcp-note {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
  line-height: 1.5;
}
.mcp-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 10px;
  margin-bottom: 10px;
}
.mcp-badge.optional {
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
}
</style>
</head>
<body>

<div class="tabs">
  <button class="tab active" data-tab="overview">Overview</button>
  <button class="tab" data-tab="settings">Settings</button>
  <button class="tab" data-tab="index">Index</button>
  <button class="tab" data-tab="mcp">MCP</button>
</div>

<!-- OVERVIEW -->
<div id="overview" class="panel active">
  <div class="model-badge">
    <span class="dot loading" id="modelDot"></span>
    <span id="modelMsg">Loading model...</span>
  </div>
  <div id="indexingProgress" class="indexing-progress" style="display:none">
    <div class="indexing-label">
      <span>Indexing workspace...</span>
      <span id="indexingText">0 / 0</span>
    </div>
    <div class="progress-track">
      <div class="progress-fill" id="progressFill" style="width:0%"></div>
    </div>
  </div>

  <div class="cards">
    <div class="card">
      <div class="card-value" id="fileCount">—</div>
      <div class="card-label">Files indexed</div>
    </div>
    <div class="card">
      <div class="card-value" id="chunkCount">—</div>
      <div class="card-label">Chunks</div>
    </div>
    <div class="card">
      <div class="card-value" id="queriesServed">0</div>
      <div class="card-label">Queries</div>
    </div>
    <div class="card">
      <div class="card-value" id="tokensServed">0</div>
      <div class="card-label">Tokens served</div>
    </div>
  </div>
  <div class="btn-row">
    <button class="btn" id="btnSearch">Search</button>
    <button class="btn btn-sec" id="btnReindex">Reindex</button>
  </div>

  <hr class="divider">

  <div class="about-title">What is pikr?</div>
  <p class="about-desc">AI coding tools burn massive tokens sending entire files as context. pikr indexes your codebase locally and sends only the relevant chunks — cutting token usage by up to 95%.</p>

  <div class="about-title">How it works</div>
  <div class="steps">
    <div class="step">
      <span class="step-num">1</span>
      <span>Parses your code into semantic chunks (functions &amp; classes) using AST — no data leaves your machine</span>
    </div>
    <div class="step">
      <span class="step-num">2</span>
      <span>Stores local embeddings in LanceDB at <code style="font-family:monospace">~/.pikr/</code> using a bundled ONNX model (~80 MB, downloaded once)</span>
    </div>
    <div class="step">
      <span class="step-num">3</span>
      <span>AI agents call <code style="font-family:monospace">search_codebase</code> via MCP and get ~4K focused tokens instead of 100K+ from full files</span>
    </div>
  </div>

  <div id="getStarted" class="get-started" style="display:none">
    <div class="gs-title">Getting started</div>
    <div class="gs-step">
      <span class="gs-num">1</span>
      <span><strong>Extension active</strong> — your workspace is being indexed automatically. Wait a moment for the chunk count above to populate.</span>
    </div>
    <div class="gs-step">
      <span class="gs-num">2</span>
      <span><strong>Connect to Claude Code (optional)</strong> — open the <strong>MCP</strong> tab for setup instructions to let Claude Code search your codebase automatically.</span>
    </div>
  </div>
</div>

<!-- MCP -->
<div id="mcp" class="panel">

  <!-- Status row -->
  <div class="mcp-status-row">
    <span class="mcp-badge optional">Optional</span>
    <span class="mcp-status-badge" id="mcpStatusBadge"></span>
  </div>

  <div class="mcp-section">
    <div class="mcp-title">What this does</div>
    <p class="mcp-desc">Connects pikr to Claude Code so the AI automatically calls <code style="font-family:monospace">search_codebase</code> instead of reading full files — cutting token usage by up to 95%.</p>
    <p class="mcp-desc">Without MCP: paste results manually.<br>With MCP: the AI fetches context on its own, every query.</p>
  </div>

  <!-- 1-click setup -->
  <div class="mcp-section" id="mcpSetupSection">
    <div class="mcp-title">1-click setup — Claude Code</div>
    <p class="mcp-desc">Pikr will run this command for you in the integrated terminal:</p>
    <div class="mcp-code-wrap">
      <code class="mcp-code" id="mcpCmd">loading...</code>
      <button class="btn-copy" id="btnCopyMcp">Copy</button>
    </div>
    <button class="btn" id="btnSetupMcp" style="margin-top:8px;width:100%">Setup Claude Code MCP</button>
    <p class="mcp-note" style="margin-top:6px">Requires Claude Code CLI installed. After setup, open your project in VS Code so pikr indexes it, then run Claude Code from the same project root.</p>
  </div>

  <!-- Already configured -->
  <div class="mcp-section" id="mcpConfiguredSection" style="display:none">
    <div class="mcp-title">Claude Code — configured</div>
    <p class="mcp-desc">pikr is registered as an MCP server. Claude Code will automatically call <code style="font-family:monospace">search_codebase</code> when it needs context from your codebase.</p>
    <button class="btn btn-sec" id="btnRefreshMcp" style="margin-top:4px">Refresh status</button>
  </div>

  <div class="mcp-section">
    <div class="mcp-title">Other agents</div>
    <p class="mcp-desc">Cursor, Windsurf, Gemini CLI — point them to <code style="font-family:monospace">dist/mcp.js</code> as a stdio MCP server using the same command pattern above.</p>
  </div>

  <div class="mcp-section">
    <div class="mcp-title">Verify</div>
    <div class="mcp-code-wrap">
      <code class="mcp-code">claude mcp list</code>
      <button class="btn-copy" id="btnCopyList">Copy</button>
    </div>
    <p class="mcp-note" style="margin-top:6px">You should see <strong>pikr — Connected</strong>.</p>
  </div>
</div>

<!-- SETTINGS -->
<div id="settings" class="panel">
  <div class="field">
    <label>Token budget</label>
    <input type="number" id="tokenBudget" min="100" step="100">
    <div class="hint">Max tokens included per context query</div>
  </div>
  <div class="field">
    <label>Top-K chunks</label>
    <input type="number" id="topK" min="1" max="200" step="1">
    <div class="hint">Chunks retrieved before reranking</div>
  </div>
  <button class="btn" id="btnSave">Save settings</button>
</div>

<!-- INDEX -->
<div id="index" class="panel">
  <div class="section-label">Indexed files</div>
  <ul class="file-list" id="fileList">
    <li class="empty">No files indexed yet</li>
  </ul>
</div>

<script>
(function () {
  const vscode = acquireVsCodeApi();

  // Tab switching
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
    });
  });

  function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(function () {
      var orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(function () { btn.textContent = orig; }, 1500);
    });
  }

  document.getElementById('btnCopyMcp').addEventListener('click', function () {
    copyText(document.getElementById('mcpCmd').textContent, this);
  });
  document.getElementById('btnCopyList').addEventListener('click', function () {
    copyText('claude mcp list', this);
  });
  document.getElementById('btnSetupMcp').addEventListener('click', function () {
    vscode.postMessage({ type: 'setupMcp' });
    this.textContent = 'Running setup...';
    this.disabled = true;
    setTimeout(function () {
      var btn = document.getElementById('btnSetupMcp');
      btn.textContent = 'Setup Claude Code MCP';
      btn.disabled = false;
    }, 4000);
  });
  document.getElementById('btnRefreshMcp').addEventListener('click', function () {
    vscode.postMessage({ type: 'refreshMcpStatus' });
  });

  document.getElementById('btnSearch').addEventListener('click', function () {
    vscode.postMessage({ type: 'search' });
  });
  document.getElementById('btnReindex').addEventListener('click', function () {
    vscode.postMessage({ type: 'reindex' });
  });
  document.getElementById('btnSave').addEventListener('click', function () {
    vscode.postMessage({ type: 'updateBudget', value: document.getElementById('tokenBudget').value });
    vscode.postMessage({ type: 'updateTopK', value: document.getElementById('topK').value });
  });

  function fmt(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function basename(p) {
    return p.split(/[\\\\/]/).pop() || p;
  }

  window.addEventListener('message', function (event) {
    var data = event.data;
    switch (data.type) {
      case 'stats': {
        document.getElementById('fileCount').textContent = fmt(data.fileCount);
        document.getElementById('chunkCount').textContent = fmt(data.chunkCount);
        document.getElementById('queriesServed').textContent = fmt(data.queriesServed);
        document.getElementById('tokensServed').textContent = fmt(data.tokensServed);
        document.getElementById('getStarted').style.display = data.chunkCount === 0 ? 'block' : 'none';
        var progressBox = document.getElementById('indexingProgress');
        if (data.indexingProgress) {
          var pct = data.indexingProgress.total > 0
            ? Math.round(data.indexingProgress.current / data.indexingProgress.total * 100) : 0;
          document.getElementById('indexingText').textContent =
            data.indexingProgress.current + ' / ' + data.indexingProgress.total;
          document.getElementById('progressFill').style.width = pct + '%';
          progressBox.style.display = 'block';
        } else {
          progressBox.style.display = 'none';
        }
        var dot = document.getElementById('modelDot');
        var msg = document.getElementById('modelMsg');
        dot.className = 'dot ' + data.modelStatus;
        msg.textContent = data.modelMessage || (
          data.modelStatus === 'ready' ? 'Model ready' :
          data.modelStatus === 'loading' ? 'Loading model...' : 'Model error'
        );
        break;
      }
      case 'config': {
        document.getElementById('tokenBudget').value = data.tokenBudget;
        document.getElementById('topK').value = data.topK;
        break;
      }
      case 'mcpInfo': {
        var badge = document.getElementById('mcpStatusBadge');
        var setupSection = document.getElementById('mcpSetupSection');
        var configuredSection = document.getElementById('mcpConfiguredSection');
        var mcpCmd = document.getElementById('mcpCmd');
        mcpCmd.textContent = 'claude mcp add -s user pikr -- node "' + data.serverPath + '"';
        if (data.status === 'configured') {
          badge.textContent = '✓ Configured';
          badge.className = 'mcp-status-badge configured';
          setupSection.style.display = 'none';
          configuredSection.style.display = 'block';
        } else {
          badge.textContent = 'Not configured';
          badge.className = 'mcp-status-badge not-configured';
          setupSection.style.display = 'block';
          configuredSection.style.display = 'none';
        }
        break;
      }
      case 'index': {
        var list = document.getElementById('fileList');
        list.innerHTML = '';
        if (!data.files || !data.files.length) {
          var empty = document.createElement('li');
          empty.className = 'empty';
          empty.textContent = 'No files indexed yet';
          list.appendChild(empty);
          break;
        }
        data.files.forEach(function (f) {
          var li = document.createElement('li');
          li.className = 'file-item';
          li.title = f.filePath;
          li.addEventListener('click', function () {
            vscode.postMessage({ type: 'openFile', filePath: f.filePath });
          });
          var name = document.createElement('span');
          name.className = 'file-name';
          name.textContent = basename(f.filePath);
          var badge = document.createElement('span');
          badge.className = 'badge';
          badge.textContent = f.chunkCount;
          li.appendChild(name);
          li.appendChild(badge);
          list.appendChild(li);
        });
        break;
      }
    }
  });

  vscode.postMessage({ type: 'ready' });
}());
</script>
</body>
</html>`;
  }
}
