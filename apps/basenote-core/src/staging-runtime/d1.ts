/**
 * Minimal structural types for Cloudflare D1. They intentionally avoid a
 * runtime import or a `D1Database` binding, so this local package cannot
 * connect to a Cloudflare account merely by being installed or tested.
 */
export interface D1Result<T = unknown> {
  readonly meta?: { readonly changes?: number };
  readonly results?: readonly T[];
  readonly success?: boolean;
}

export interface D1PreparedStatement {
  bind(...values: readonly unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1DatabasePort {
  batch(statements: readonly D1PreparedStatement[]): Promise<readonly D1Result[]>;
  prepare(query: string): D1PreparedStatement;
}
