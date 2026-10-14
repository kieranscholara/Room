import type { LocalStatus } from './runtime-target.mjs';
export function localTestPreflight(): Promise<LocalStatus & { DB_URL: string }>;
