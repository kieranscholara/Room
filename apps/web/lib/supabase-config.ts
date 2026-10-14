import 'server-only';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ServiceError } from './editor-service';

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
  const url = process.env.SUPABASE_URL || status.API_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || status.ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || status.SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey)
    throw new ServiceError(
      503,
      'Supabase is not configured. Configure server environment bindings or run the local setup.',
    );
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !(local && ['127.0.0.1', 'localhost'].includes(parsed.hostname)))
    throw new ServiceError(503, 'Hosted Supabase requires an HTTPS URL.');
  return { url, anonKey, serviceKey, local };
}
