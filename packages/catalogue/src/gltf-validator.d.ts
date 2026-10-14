declare module 'gltf-validator' {
  interface Report {
    issues: {
      numErrors: number;
      numWarnings: number;
      messages?: Array<{ code: string; message: string; severity: number }>;
    };
  }
  interface Options {
    maxIssues?: number;
    externalResourceFunction?: (uri: string) => Promise<Uint8Array>;
  }
  export function validateBytes(bytes: Uint8Array, options?: Options): Promise<Report>;
  export function validateString(json: string, options?: Options): Promise<Report>;
}
