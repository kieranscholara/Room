import { ServiceError } from './editor-service';

export function demoEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.ROOMSELL_ENABLE_DEMO === '1';
}

export function assertDemoEnabled(): void {
  if (!demoEnabled()) throw new ServiceError(404, 'Demo is disabled.');
}
