export function deploymentChecks(
  environment: Record<string, string | undefined>,
): { name: string; passed: boolean }[];
