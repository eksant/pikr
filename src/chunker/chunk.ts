export type ChunkKind = 'function' | 'class' | 'method' | 'interface' | 'type' | 'variable';

export interface Chunk {
  id: string; // sha1(filePath + startLine)
  filePath: string;
  language: string;
  kind: ChunkKind;
  name: string; // function/class name
  text: string; // raw source code
  startLine: number;
  endLine: number;
  lastModified: number; // unix ms
}
