import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';
const { fetch, AbortSignal } = globalThis;

try {
  const local = process.argv.includes('--local');
  const value = process.argv[process.argv.indexOf('--url') + 1];
  if (!process.argv.includes('--url') || !value) throw new Error('Supply --url with the application origin.');
  const origin = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    (local ? !loopback || origin.protocol !== 'http:' : loopback || origin.protocol !== 'https:')
  )
    throw new Error('Use a plain HTTPS origin, or --local with an HTTP loopback origin.');
  const monitor = process.argv.includes('--monitor');
  const routes = monitor
    ? [['/api/internal/operations', 200]]
    : [
        ['/api/health', 200],
        ['/api/auth/session', 401],
        ['/auth/login', 200],
        ['/auth/forgot-password', 200],
        ['/auth/reset-password', 200],
        ['/testing', 404],
        ['/api/testing/status', 404],
        ['/demo', 404],
        ['/api/scene', 404],
      ];
  const secret = process.env.ROOMSELL_WORKER_TOKEN || process.env.CRON_SECRET;
  if (monitor && (!secret || secret.length < 32))
    throw new Error('A worker secret must be supplied through the environment for monitoring.');
  let failures = 0;
  for (const [route, expected] of routes) {
    const response = await fetch(new URL(route, origin), {
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: monitor ? { Authorization: 'Bearer ' + secret } : {},
    });
    let passed = response.status === expected;
    if (route === '/api/health' && passed) passed = (await response.json()).status === 'ok';
    else if (monitor) {
      const result = await response.json();
      passed = passed && result.status === 'ok';
      console.log(
        JSON.stringify({
          status: result.status,
          queued: result.queued,
          running: result.running,
          failedLast24Hours: result.failedLast24Hours,
          oldestQueuedSeconds: result.oldestQueuedSeconds,
          expiredLeases: result.expiredLeases,
          supplierPendingOverFiveMinutes: result.supplierPendingOverFiveMinutes,
        }),
      );
    } else await response.body?.cancel();
    console.log((passed ? 'PASS ' : 'FAIL ') + route + ' HTTP ' + response.status);
    if (!passed) failures++;
  }
  if (failures) process.exitCode = 1;
} catch {
  console.error(
    'Staging check failed. Check --url, service availability and the required environment bindings.',
  );
  process.exitCode = 1;
}
