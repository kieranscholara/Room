import { URL } from 'node:url';

// Shared server/CLI policy. Errors name missing bindings, never their contents.
export const hostedBindingNames = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
];

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function loopbackEndpoint(value, protocol, port) {
  try {
    const url = new URL(value);
    return (
      url.protocol === protocol &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      url.port === port &&
      !url.search &&
      !url.hash &&
      (protocol !== 'http:' || (!url.username && !url.password && url.pathname === '/'))
    );
  } catch {
    return false;
  }
}

export function assertLocalStatus(status, { requireDatabase = false } = {}) {
  if (
    !status ||
    !loopbackEndpoint(status.API_URL, 'http:', '54321') ||
    !nonempty(status.ANON_KEY) ||
    !nonempty(status.SERVICE_ROLE_KEY) ||
    (requireDatabase && !loopbackEndpoint(status.DB_URL, 'postgresql:', '54322'))
  ) {
    throw new Error('Local Supabase status is incomplete or does not identify this local stack.');
  }
  return status;
}

export function selectSupabaseTarget(environment, status) {
  if (environment.ROOMSELL_LOCAL_SUPABASE === '1') {
    const verified = assertLocalStatus(status);
    return {
      url: verified.API_URL,
      anonKey: verified.ANON_KEY,
      serviceKey: verified.SERVICE_ROLE_KEY,
      local: true,
    };
  }
  if (
    !['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].every((key) =>
      nonempty(environment[key]),
    )
  ) {
    throw new Error(
      'Hosted Supabase requires SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }
  let url;
  try {
    url = new URL(environment.SUPABASE_URL);
  } catch {
    throw new Error('Hosted Supabase requires a valid HTTPS URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Hosted Supabase requires a valid HTTPS URL.');
  }
  return {
    url: environment.SUPABASE_URL,
    anonKey: environment.SUPABASE_ANON_KEY,
    serviceKey: environment.SUPABASE_SERVICE_ROLE_KEY,
    local: false,
  };
}

export function assertLocalTestEnvironment(environment, environmentFiles = []) {
  const configured = new Set(hostedBindingNames.filter((key) => nonempty(environment[key])));
  // Examine every Next.js environment file, including values masked by another file.
  // Conservative matching deliberately rejects ambiguous or interpolated bindings.
  for (const contents of environmentFiles) {
    for (const line of contents.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match || !hostedBindingNames.includes(match[1])) continue;
      const value = match[2].replace(/\s+#.*$/, '').trim();
      if (value && value !== '""' && value !== "''") configured.add(match[1]);
    }
  }
  if (configured.size) {
    throw new Error(
      `Local tests refuse configured Supabase bindings: ${[...configured].sort().join(', ')}. Use an isolated local test environment.`,
    );
  }
}
