import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ConsoleLogger } from '../utils/logger';
import { ModelManager } from '../embedder/model-manager';
import { Embedder } from '../embedder/embedder';
import { VectorStore } from '../store/vector-store';
import { Retriever } from '../retrieval/retriever';
import { ContextBuilder } from '../context/builder';

const logger = new ConsoleLogger();

const pikrRoot = path.join(os.homedir(), '.pikr');
const wsHash = crypto.createHash('sha256').update(process.cwd()).digest('hex').slice(0, 16);
const storePath = path.join(pikrRoot, wsHash);

const modelManager = new ModelManager(pikrRoot, logger);
const embedder = new Embedder(modelManager, logger);
const vectorStore = new VectorStore(storePath, logger);
const retriever = new Retriever(embedder, vectorStore, 20, logger);

const server = new Server({ name: 'pikr', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search_codebase',
      description:
        'Search the locally indexed codebase for relevant code chunks. ' +
        'Returns the most relevant functions, classes, and code blocks trimmed to a token budget. ' +
        'Use this instead of reading full files to save tokens.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Describe what you are looking for (e.g. "auth middleware", "database connection setup")',
          },
          tokenBudget: {
            type: 'number',
            description: 'Max tokens to return (default: 8000)',
          },
        },
        required: ['query'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'search_codebase') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { query, tokenBudget } = request.params.arguments as {
    query: string;
    tokenBudget?: number;
  };

  const builder = new ContextBuilder(tokenBudget ?? 8000);
  const chunks = await retriever.retrieve(query);
  const result = builder.build(chunks);

  const text = result.text || 'No relevant code found for this query.';
  const summary = `// pikr: ${result.chunkCount} chunks, ${result.tokenCount} tokens (saved ~${result.savedTokens} vs full codebase)\n\n`;

  return {
    content: [{ type: 'text', text: summary + text }],
  };
});

async function main(): Promise<void> {
  await vectorStore.open();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('pikr MCP server running');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
