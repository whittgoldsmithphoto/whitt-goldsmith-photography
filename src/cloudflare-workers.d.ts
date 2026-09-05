declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}