import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { EditorService, type Persistence, type RecordData } from './editor-service';
import { assertDemoEnabled } from './demo-policy';

export class FilePersistence implements Persistence {
  constructor(private path: string) {}
  async load(): Promise<RecordData | null> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as RecordData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async save(data: RecordData): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(temporary, this.path);
  }
}
const globalService = globalThis as typeof globalThis & { roomsellEditor?: EditorService };
export function service(): EditorService {
  assertDemoEnabled();
  return (globalService.roomsellEditor ??= new EditorService(
    new FilePersistence(resolve(process.env.ROOMSELL_DATA_DIR || '.local', 'scene.json')),
  ));
}
