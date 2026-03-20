# pikr — Pick the right context

> **Stop sending 100K tokens when 4K will do.**
> Local RAG for AI coding tools — indexes your codebase and sends only the relevant code as context.

[![Version](https://img.shields.io/visual-studio-marketplace/v/eksant.pikr?color=6366f1&label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=eksant.pikr)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/eksant.pikr?color=6366f1)](https://marketplace.visualstudio.com/items?itemName=eksant.pikr)
[![License: MIT](https://img.shields.io/badge/license-MIT-6366f1)](LICENSE.txt)
[![GitHub Issues](https://img.shields.io/github/issues/eksant/pikr?color=6366f1)](https://github.com/eksant/pikr/issues)

---

## The problem

AI coding tools (Claude Code, GitHub Copilot, Cursor) burn through tokens by sending entire files as context — most of it irrelevant. There's no built-in way to selectively pick which functions or classes get sent.

**pikr fixes this.** It indexes your codebase locally and exposes a `search_codebase` MCP tool. Instead of reading full files, your AI agent retrieves only what's relevant — by semantic meaning, recency, and proximity to open files.

**Result: ~4–8K focused tokens instead of 100K+**

---

## Features

- 🔒 **100% local** — embeddings, vector DB, and search all run on your machine. No data leaves.
- 🌳 **AST-aware chunking** — TypeScript & JavaScript parsed by function/class via tree-sitter, not by line count
- 🌐 **Multi-language** — regex-based chunking for Python, Go, Rust, PHP, Ruby, Swift, Kotlin, Java, C#
- ⚡ **Local embeddings** — all-MiniLM-L6-v2 via ONNX Runtime (~80 MB, downloaded once, runs offline)
- 🎯 **Smart reranking** — combines semantic similarity, recency decay, and open-file proximity
- 🔌 **MCP server** — Claude Code, Cursor, Windsurf, and any MCP-compatible agent can call `search_codebase`
- 📊 **Dashboard** — stats, settings, file browser, and 1-click MCP setup — all in the VS Code sidebar
- 💰 **Token budget** — configurable cap (default 4K) so you never overshoot

---

## Install

**From VS Code Marketplace** — search for `pikr` in the Extensions panel, or:

```
ext install eksant.pikr
```

**Quick Open** (`Ctrl+P` / `Cmd+P`):

```
ext install eksant.pikr
```

**From .vsix** (manual):

```bash
code --install-extension pikr-0.1.0.vsix
```

---

## Getting started

### 1. Extension activates — indexing starts automatically

On first activation, pikr downloads the embedding model (~80 MB) to `~/.pikr/models/`. Watch progress in **View → Output → pikr**.

Indexing starts automatically for all supported files (excluding `node_modules`, `dist`, `.git`):

| Chunker | Languages |
|---|---|
| AST (tree-sitter) | TypeScript, JavaScript (+ JSX, TSX, MJS, CJS) |
| Regex | Python, Go, Rust, PHP, Ruby, Swift, Kotlin, Java, C# |

### 2. Open the dashboard

Click the **pikr icon** in the activity bar. Three tabs + one optional tab:

| Tab | What you'll find |
|---|---|
| **Overview** | Model status, index stats (files/chunks), session usage, Search & Reindex buttons |
| **Settings** | Token budget and Top-K, saved directly to VS Code config |
| **Index** | All indexed files with chunk counts — click any file to open it |
| **MCP** | 1-click Claude Code setup, real server path, and connection status |

### 3. Connect to your AI agent (optional but recommended)

Open the **MCP tab** in the dashboard and click **"Setup Claude Code MCP"** — it runs the setup command in your terminal automatically.

Or manually:

```bash
claude mcp add pikr -- node /absolute/path/to/pikr/dist/mcp.js
```

Then verify:

```bash
claude mcp list
# → pikr — Connected
```

---

## Commands

Open the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`):

| Command | Description |
|---|---|
| `pikr: Search context` | Enter a query → opens a document with the most relevant code chunks |
| `pikr: Set token budget` | Change the max tokens included in context (default: 4000) |
| `pikr: Reindex workspace` | Trigger a manual full reindex |
| `pikr: Open dashboard` | Open the pikr sidebar dashboard |

---

## MCP Integration

pikr ships a standalone MCP server (`dist/mcp.js`) with one tool:

| Tool | Input | Output |
|---|---|---|
| `search_codebase` | `query: string` | Relevant code chunks, trimmed to token budget |

Works with **Claude Code**, **Cursor**, **Windsurf**, **Gemini CLI**, and any stdio MCP-compatible agent.

> **Important:** Run your AI agent from your project root so pikr finds the right index (`~/.pikr/<hash-of-cwd>/`). Open the project in VS Code first to ensure it's indexed.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `pikr.tokenBudget` | `4000` | Max tokens to include per context query |
| `pikr.topK` | `20` | Candidates retrieved before reranking |

---

## How it works

```
VS Code Extension:
  File watcher → AST/regex chunker → ONNX embedder → LanceDB (~/.pikr/<hash>/)

MCP Server / Search command:
  Query → ONNX embedder → vector search → reranker → context builder → AI agent
```

**Stack:** TypeScript · LanceDB · ONNX Runtime · tree-sitter · MCP SDK · esbuild

- **LanceDB** — embedded vector DB, no server needed, same tech used by Continue IDE
- **tree-sitter** — pure-JS grammars for TS/JS (works in VS Code's Electron environment)
- **all-MiniLM-L6-v2** — 384-dimension embeddings, fast enough for local use, accurate enough for code

---

## Local development

```bash
git clone https://github.com/eksant/pikr
cd pikr
npm install
npm run build
```

Press `F5` in VS Code to open the Extension Development Host with pikr loaded.

```bash
npm run watch        # rebuild on save
npm run lint         # ESLint
npm run format       # Prettier
npm test             # vitest unit tests
```

---

## Requirements

- VS Code 1.85+
- Internet connection on first activation (one-time model download ~80 MB)

---

## Issues & Feedback

Found a bug or have a feature request? Please open an issue:

**[→ github.com/eksant/pikr/issues](https://github.com/eksant/pikr/issues)**

Questions or ideas? Start a discussion:

**[→ github.com/eksant/pikr/discussions](https://github.com/eksant/pikr/discussions)**

---

## License

[MIT](LICENSE.txt) © 2025 eksant
