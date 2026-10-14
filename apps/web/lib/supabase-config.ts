import 'server-only';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ServiceError } from './editor-service';
import { selectSupabaseTarget } from '../../../scripts/runtime-target.mjs';

export function supabaseConfig() {
  const local = process.env.ROOMSELL_LOCAL_SUPABASE === '1';
  let status: Record<string, string> = {};
  if (local) {
    try {
      status = JSON.parse(readFileSync(resolve(process.cwd(), '../../.local/infra/status.json'), 'utf8'));
    } catch {
      throw new ServiceError(
        503,
        'Local database is unavailable. Run npm run setup:local and npm run db:migrate.',
      );
    }
  }
  try {
    return selectSupabaseTarget(process.env, status);
  } catch (error) {
    throw new ServiceError(
      503,
      error instanceof Error ? error.message : 'Supabase configuration is invalid.',
    );
  }
}
