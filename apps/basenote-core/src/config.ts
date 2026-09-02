export interface LocalConfig {
  readonly host: "127.0.0.1" | "localhost" | "::1";
  readonly mode: "local";
  readonly port: number;
}

const FORBIDDEN_LOCAL_SECRET_KEYS = [
  "SHOPIFY_API_KEY",
  "SHOPIFY_API_SECRET",
  "SHOPIFY_ADMIN_ACCESS_TOKEN",
  "SHOPIFY_APP_PROXY_SECRET",
  "SHOPIFY_APP_PROXY_SHARED_SECRET",
  "APPSTLE_API_KEY",
  "DATABASE_URL",
  "CLOUDFLARE_API_TOKEN",
] as const;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "::1"]);

export function readLocalConfig(env: NodeJS.ProcessEnv = process.env): LocalConfig {
  const requestedMode = env.BASENOTE_APP_MODE ?? "local";
  if (requestedMode !== "local") {
    throw new Error(
      "Base Note Core is intentionally local-only. Complete the README production gates before enabling another mode.",
    );
  }

  const presentSecrets = FORBIDDEN_LOCAL_SECRET_KEYS.filter((key) => Boolean(env[key]?.trim()));
  if (presentSecrets.length > 0) {
    throw new Error(
      `Refusing local startup while credential-like environment variables are set: ${presentSecrets.join(", ")}`,
    );
  }

  const candidateHost = env.HOST ?? "127.0.0.1";
  if (!LOOPBACK_HOSTS.has(candidateHost)) {
    throw new Error("Local mode only permits a loopback HOST (127.0.0.1, localhost, or ::1).");
  }

  const candidatePort = Number(env.PORT ?? "3000");
  if (!Number.isSafeInteger(candidatePort) || candidatePort < 1024 || candidatePort > 65535) {
    throw new Error("PORT must be an integer between 1024 and 65535.");
  }

  return {
    host: candidateHost as LocalConfig["host"],
    mode: "local",
    port: candidatePort,
  };
}
