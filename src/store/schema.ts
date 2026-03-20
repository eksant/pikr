export const VECTOR_DIMS = 384;
export const TABLE_NAME = 'chunks';

// Schema matches LanceDB row format
export interface ChunkRecord {
  id: string;
  vector: number[]; // 384-dim embedding
  filePath: string;
  language: string;
  kind: string;
  name: string;
  text: string;
  startLine: number;
  endLine: number;
  lastModified: number; // unix ms
}
