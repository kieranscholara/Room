export const hostedBindingNames: readonly string[];
export interface LocalStatus {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
  DB_URL?: string;
  [key: string]: unknown;
}
export function assertLocalStatus(status: unknown, options?: { requireDatabase?: boolean }): LocalStatus;
export function selectSupabaseTarget(
  environment: Record<string, string | undefined>,
  status?: unknown,
): {
  url: string;
  anonKey: string;
  serviceKey: string;
  local: boolean;
};
export function assertLocalTestEnvironment(
  environment: Record<string, string | undefined>,
  environmentFiles?: string[],
): void;
