import process from 'node:process';
import console from 'node:console';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';

function publicHttps(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      !url.hostname.endsWith('.test')
    );
  } catch {
    return false;
  }
}
export function deploymentChecks(environment) {
  const checks = [];
  const add = (name, passed) => checks.push({ name, passed: Boolean(passed) });
  for (const flag of ['ROOMSELL_LOCAL_SUPABASE', 'ROOMSELL_ENABLE_DEMO', 'ROOMSELL_ENABLE_TEST_CUSTOMER'])
    add(flag + ' disabled', !environment[flag] || environment[flag] === '0');
  for (const name of ['SUPABASE_URL', 'ROOMSELL_PUBLIC_ORIGIN'])
    add(name + ' public HTTPS origin', publicHttps(environment[name]));
  for (const name of ['SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])
    add(name + ' present', environment[name]?.trim());
  add(
    'Supabase service key differs from anonymous key',
    environment.SUPABASE_SERVICE_ROLE_KEY &&
      environment.SUPABASE_SERVICE_ROLE_KEY !== environment.SUPABASE_ANON_KEY,
  );
  const key = environment.ROOMSELL_CONNECTOR_ENCRYPTION_KEY;
  add(
    'Stable connector encryption key configured',
    typeof key === 'string' &&
      /^[A-Za-z0-9+/]{43}=$/.test(key) &&
      Buffer.from(key, 'base64').length === 32 &&
      Buffer.from(key, 'base64').toString('base64') === key,
  );
  add(
    'Worker secret configured',
    (environment.ROOMSELL_WORKER_TOKEN || environment.CRON_SECRET || '').length >= 32,
  );
  add(
    'Cron and worker secrets aligned',
    !environment.ROOMSELL_WORKER_TOKEN ||
      !environment.CRON_SECRET ||
      environment.ROOMSELL_WORKER_TOKEN === environment.CRON_SECRET,
  );
  add('OpenAI binding present', (environment.ROOMSELL_AI_API_KEY || environment.OPENAI_API_KEY || '').trim());
  return checks;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checks = deploymentChecks(process.env);
  for (const check of checks) console.log((check.passed ? 'PASS ' : 'FAIL ') + check.name);
  console.log(
    'Checks inspect configuration only. Live AI, email, supplier acceptance, backups and managed hosting require separate verification. No secret values are printed.',
  );
  if (checks.some((check) => !check.passed)) process.exitCode = 1;
}
