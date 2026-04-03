import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const PIKR_CLI = path.join(os.homedir(), '.pikr', 'cli.js');
const HOOK_SENTINEL = '# pikr-hook-version:';

// ─── Claude Code ────────────────────────────────────────────────────────────

function claudeHookScript(): string {
  return `#!/usr/bin/env bash
${HOOK_SENTINEL} 1
# pikr shell compression hook for Claude Code.
# Rewrites known shell commands through pikr's output compressor.
# Requires: jq, node

if ! command -v jq &>/dev/null; then
  echo "[pikr] WARNING: jq not installed — hook inactive" >&2
  exit 0
fi

CLI="$HOME/.pikr/cli.js"
if [ ! -f "$CLI" ]; then
  echo "[pikr] WARNING: $CLI not found — run pikr extension in VS Code first" >&2
  exit 0
fi

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$CMD" ]; then
  exit 0
fi

# Skip if already processed by pikr or RTK
if [[ "$CMD" == *"cli.js"* ]] || [[ "$CMD" == rtk* ]]; then
  exit 0
fi

# Only compress known commands
FIRST_WORD=$(echo "$CMD" | awk '{print $1}')
case "$FIRST_WORD" in
  git|ls|cat|grep|rg|npm|pnpm|yarn|vitest|jest|pytest)
    ;;
  go|cargo)
    SECOND_WORD=$(echo "$CMD" | awk '{print $2}')
    case "$SECOND_WORD" in test|build) ;; *) exit 0 ;; esac
    ;;
  *)
    exit 0
    ;;
esac

PIKR_CMD=$(printf '%q' "$CMD")
REWRITTEN="PIKR_CMD=$PIKR_CMD node \\"$HOME/.pikr/cli.js\\" compress"

ORIGINAL_INPUT=$(printf '%s' "$INPUT" | jq -c '.tool_input')
UPDATED_INPUT=$(printf '%s' "$ORIGINAL_INPUT" | jq --arg cmd "$REWRITTEN" '.command = $cmd')

jq -n \\
  --argjson updated "$UPDATED_INPUT" \\
  '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "allow",
      "permissionDecisionReason": "pikr compress auto-rewrite",
      "updatedInput": $updated
    }
  }'
`;
}

function installClaudeHook(global: boolean): void {
  const hooksDir = path.join(os.homedir(), '.claude', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  const hookFile = path.join(hooksDir, 'pikr-compress.sh');
  fs.writeFileSync(hookFile, claudeHookScript(), 'utf8');
  fs.chmodSync(hookFile, 0o755);

  // Patch settings.json
  const settingsFile = path.join(os.homedir(), '.claude', 'settings.json');
  let settings: Record<string, unknown> = {};
  try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { /* new file */ }

  const hooks = (settings['hooks'] ?? {}) as Record<string, unknown>;
  const preToolUse = (hooks['PreToolUse'] ?? []) as Array<{ matcher: string; hooks: { type: string; command: string }[] }>;

  // Find or create the Bash matcher
  let bashMatcher = preToolUse.find(e => e.matcher === 'Bash');
  if (!bashMatcher) {
    bashMatcher = { matcher: 'Bash', hooks: [] };
    preToolUse.push(bashMatcher);
  }

  // Idempotent: remove old pikr entry then re-add
  bashMatcher.hooks = bashMatcher.hooks.filter(h => !h.command.includes('pikr-compress'));
  bashMatcher.hooks.push({ type: 'command', command: hookFile });

  hooks['PreToolUse'] = preToolUse;
  settings['hooks'] = hooks;

  // Backup + write
  if (fs.existsSync(settingsFile)) {
    fs.copyFileSync(settingsFile, settingsFile + '.bak');
  }
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n', 'utf8');

  console.log(`  Hook:     ${hookFile}`);
  console.log(`  settings: ${settingsFile} (hook added)`);
}

// ─── Gemini CLI ─────────────────────────────────────────────────────────────

function geminiHookScript(): string {
  return `#!/usr/bin/env bash
${HOOK_SENTINEL} 1
# pikr shell compression hook for Gemini CLI.

if ! command -v jq &>/dev/null; then
  echo "[pikr] WARNING: jq not installed — hook inactive" >&2
  exit 0
fi

CLI="$HOME/.pikr/cli.js"
if [ ! -f "$CLI" ]; then
  exit 0
fi

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // .tool_input.cmd // empty')

if [ -z "$CMD" ]; then
  exit 0
fi

if [[ "$CMD" == *"cli.js"* ]] || [[ "$CMD" == rtk* ]]; then
  exit 0
fi

FIRST_WORD=$(echo "$CMD" | awk '{print $1}')
case "$FIRST_WORD" in
  git|ls|cat|grep|rg|npm|pnpm|yarn|vitest|jest|pytest) ;;
  *) exit 0 ;;
esac

PIKR_CMD=$(printf '%q' "$CMD")
REWRITTEN="PIKR_CMD=$PIKR_CMD node \\"$HOME/.pikr/cli.js\\" compress"

ORIGINAL_INPUT=$(printf '%s' "$INPUT" | jq -c '.tool_input')
UPDATED_INPUT=$(printf '%s' "$ORIGINAL_INPUT" | jq --arg cmd "$REWRITTEN" '.command = $cmd')

jq -n \\
  --argjson updated "$UPDATED_INPUT" \\
  '{
    "hookSpecificOutput": {
      "hookEventName": "BeforeTool",
      "permissionDecision": "allow",
      "permissionDecisionReason": "pikr compress auto-rewrite",
      "updatedInput": $updated
    }
  }'
`;
}

function installGeminiHook(): void {
  const geminiDir = path.join(os.homedir(), '.gemini');
  const hooksDir = path.join(geminiDir, 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  const hookFile = path.join(hooksDir, 'pikr-compress.sh');
  fs.writeFileSync(hookFile, geminiHookScript(), 'utf8');
  fs.chmodSync(hookFile, 0o755);

  // Patch settings.json
  const settingsFile = path.join(geminiDir, 'settings.json');
  let settings: Record<string, unknown> = {};
  try { settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { /* new file */ }

  const hooks = (settings['hooks'] ?? {}) as Record<string, unknown>;
  const beforeTool = (hooks['BeforeTool'] ?? []) as Array<{ matcher: string; hooks: { type: string; command: string }[] }>;

  let matcher = beforeTool.find(e => e.matcher === 'run_shell_command');
  if (!matcher) {
    matcher = { matcher: 'run_shell_command', hooks: [] };
    beforeTool.push(matcher);
  }

  matcher.hooks = matcher.hooks.filter(h => !h.command.includes('pikr-compress'));
  matcher.hooks.push({ type: 'command', command: hookFile });

  hooks['BeforeTool'] = beforeTool;
  settings['hooks'] = hooks;

  if (fs.existsSync(settingsFile)) {
    fs.copyFileSync(settingsFile, settingsFile + '.bak');
  }
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n', 'utf8');

  console.log(`  Hook:     ${hookFile}`);
  console.log(`  settings: ${settingsFile} (hook added)`);
}

// ─── Entry ───────────────────────────────────────────────────────────────────

export function runInit(args: string[]): void {
  if (process.platform === 'win32') {
    console.error('[pikr] Windows not yet supported — hooks require bash. Use WSL.');
    process.exit(1);
  }

  const global = args.includes('-g') || args.includes('--global');

  console.log(`\npikr init${global ? ' -g' : ''}\n`);

  console.log('Claude Code:');
  installClaudeHook(global);

  console.log('\nGemini CLI:');
  installGeminiHook();

  console.log(`
Done. Restart Claude Code and Gemini CLI.
Test with: git status
Check savings: node ${PIKR_CLI} gain
`);
}
