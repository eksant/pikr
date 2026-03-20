import * as path from 'path';
import { ChunkRecord, TABLE_NAME, VECTOR_DIMS } from './schema';
import { ILogger } from '../utils/logger';

// LanceDB types (avoid direct import to allow lazy loading)
type LanceTable = {
  add: (rows: ChunkRecord[]) => Promise<void>;
  delete: (filter: string) => Promise<void>;
  search: (vector: number[]) => LanceQuery;
  countRows: () => Promise<number>;
};
type LanceQuery = {
  limit: (n: number) => LanceQuery;
  where: (filter: string) => LanceQuery;
  toArray: () => Promise<ChunkRecord[]>;
};
type LanceDB = {
  connect: (uri: string) => Promise<LanceConnection>;
};
type LanceConnection = {
  tableNames: () => Promise<string[]>;
  createTable: (name: string, data: ChunkRecord[], opts?: object) => Promise<LanceTable>;
  openTable: (name: string) => Promise<LanceTable>;
};

export class VectorStore {
  private db: LanceConnection | undefined;
  private table: LanceTable | undefined;
  private readonly dbPath: string;

  constructor(
    storePath: string,
    private readonly logger: ILogger,
  ) {
    this.dbPath = path.join(storePath, 'lancedb');
  }

  async open(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lancedb = require('@lancedb/lancedb') as LanceDB;
    this.db = await lancedb.connect(this.dbPath);

    const tables = await this.db.tableNames();
    if (tables.includes(TABLE_NAME)) {
      this.table = await this.db.openTable(TABLE_NAME);
    } else {
      // Create table with a placeholder row so schema is established
      const placeholder = this.placeholder();
      this.table = await this.db.createTable(TABLE_NAME, [placeholder], {
        mode: 'create',
      });
      await this.table.delete(`id = 'placeholder'`);
    }
    this.logger.info(`VectorStore opened at ${this.dbPath}`);
  }

  async upsert(records: ChunkRecord[]): Promise<void> {
    if (!records.length) return;
    // Delete existing rows for the same ids, then add fresh
    const ids = records.map((r) => `'${r.id}'`).join(', ');
    await this.table!.delete(`id IN (${ids})`);
    await this.table!.add(records);
  }

  async deleteByFile(filePath: string): Promise<void> {
    await this.table!.delete(`filePath = '${filePath.replace(/'/g, "\\'")}'`);
  }

  async search(vector: number[], topK: number): Promise<ChunkRecord[]> {
    return this.table!.search(vector).limit(topK).toArray();
  }

  async count(): Promise<number> {
    return this.table!.countRows();
  }

  private placeholder(): ChunkRecord {
    return {
      id: 'placeholder',
      vector: new Array(VECTOR_DIMS).fill(0),
      filePath: '',
      language: '',
      kind: 'function',
      name: '',
      text: '',
      startLine: 0,
      endLine: 0,
      lastModified: 0,
    };
  }
}
