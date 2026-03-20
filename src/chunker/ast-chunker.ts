import * as path from 'path';
import * as crypto from 'crypto';
import { Chunk, ChunkKind } from './chunk';

// tree-sitter types
type TSLanguage = object;
type TSNode = {
  type: string;
  text: string;
  startPosition: { row: number };
  endPosition: { row: number };
  childForFieldName: (name: string) => TSNode | null;
  children: TSNode[];
  namedChildren: TSNode[];
};
type TSTree = { rootNode: TSNode };
type TSParser = {
  setLanguage: (lang: TSLanguage) => void;
  parse: (code: string) => TSTree;
};

// Lazy loaded to avoid issues during module init
let Parser: new () => TSParser;
let tsLang: TSLanguage;
let jsLang: TSLanguage;

async function ensureLoaded(): Promise<void> {
  if (Parser) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Parser = require('tree-sitter');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  tsLang = require('tree-sitter-typescript').typescript;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  jsLang = require('tree-sitter-javascript');
}

const CHUNK_NODE_TYPES = new Set([
  'function_declaration',
  'function',
  'arrow_function',
  'method_definition',
  'class_declaration',
  'class',
  'interface_declaration',
  'type_alias_declaration',
  'lexical_declaration',
  'variable_declaration',
]);

const KIND_MAP: Record<string, ChunkKind> = {
  function_declaration: 'function',
  function: 'function',
  arrow_function: 'function',
  method_definition: 'method',
  class_declaration: 'class',
  class: 'class',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
  lexical_declaration: 'variable',
  variable_declaration: 'variable',
};

function extractName(node: TSNode): string {
  const nameNode =
    node.childForFieldName('name') ??
    node.childForFieldName('left') ??
    node.namedChildren.find((c) => c.type === 'identifier');
  return nameNode?.text ?? '<anonymous>';
}

function chunkId(filePath: string, startLine: number): string {
  return crypto.createHash('sha1').update(`${filePath}:${startLine}`).digest('hex').slice(0, 16);
}

function walkTree(
  node: TSNode,
  filePath: string,
  language: string,
  lastModified: number,
  chunks: Chunk[],
): void {
  if (CHUNK_NODE_TYPES.has(node.type)) {
    chunks.push({
      id: chunkId(filePath, node.startPosition.row),
      filePath,
      language,
      kind: KIND_MAP[node.type] ?? 'function',
      name: extractName(node),
      text: node.text,
      startLine: node.startPosition.row,
      endLine: node.endPosition.row,
      lastModified,
    });
    return; // don't recurse inside — avoid double-counting nested functions
  }
  for (const child of node.namedChildren) {
    walkTree(child, filePath, language, lastModified, chunks);
  }
}

export class AstChunker {
  async chunk(filePath: string, content: string, lastModified: number): Promise<Chunk[]> {
    await ensureLoaded();

    const ext = path.extname(filePath).toLowerCase();
    let language: TSLanguage;
    let langName: string;

    if (ext === '.ts' || ext === '.tsx') {
      language = tsLang;
      langName = 'typescript';
    } else if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') {
      language = jsLang;
      langName = 'javascript';
    } else {
      return [];
    }

    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(content);
    const chunks: Chunk[] = [];
    walkTree(tree.rootNode, filePath, langName, lastModified, chunks);
    return chunks;
  }

  canHandle(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext);
  }
}
