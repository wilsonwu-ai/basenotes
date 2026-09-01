import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "README.md",
  "package.json",
  "tsconfig.json",
  ".env.example",
  "shopify.app.example.toml",
  "shopify.app.staging.example.toml",
  "src/config.ts",
  "src/index.ts",
  "src/domain/ids.ts",
  "src/domain/queue.ts",
  "src/domain/queue.test.ts",
  "src/profile-queue/contracts.ts",
  "src/profile-queue/service.ts",
  "src/profile-queue/repository.ts",
  "src/profile-queue/d1-repository.ts",
  "src/profile-queue/ui.ts",
  "src/subscription-history/contracts.ts",
  "src/subscription-history/backfill-importer.ts",
  "migrations/0001_staging_runtime.sql",
  "src/platform/subscription-gateway.ts",
  "src/shopify-staging/webhook.ts",
  "src/shopify-staging/app-proxy-bridge.ts",
];

const missing = requiredFiles.filter((file) => !existsSync(resolve(root, file)));
if (missing.length > 0) {
  throw new Error(`Missing required local foundation files: ${missing.join(", ")}`);
}

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
if (pkg.private !== true || pkg.name !== "@basenote/core") {
  throw new Error("package.json must remain a private @basenote/core local package.");
}

const envExample = readFileSync(resolve(root, ".env.example"), "utf8");
const configuredSecret = envExample
  .split(/\r?\n/)
  .find((line) => /^(SHOPIFY|APPSTLE|CLOUDFLARE|DATABASE)_[A-Z0-9_]+=.+/.test(line));
if (configuredSecret) {
  throw new Error(".env.example must not contain a credential value.");
}

const appTemplate = readFileSync(resolve(root, "shopify.app.example.toml"), "utf8");
if (!appTemplate.includes("REPLACE_ONLY_AFTER_EXISTING_DEV_DASHBOARD_APP_IS_APPROVED_FOR_LINKING")) {
  throw new Error("The Shopify template must remain deliberately unlinked.");
}

const stagingAppTemplate = readFileSync(resolve(root, "shopify.app.staging.example.toml"), "utf8");
for (const requiredFragment of [
  "REPLACE_WITH_A_SEPARATE_STAGING_DEV_DASHBOARD_APP_CLIENT_ID",
  "application_url = \"https://app-staging.basenotescent.com\"",
  "scopes = \"read_customers,read_products,write_app_proxy\"",
  "url = \"https://app-staging.basenotescent.com/api/shopify/app-proxy\"",
  "subpath = \"basenote-staging\"",
]) {
  if (!stagingAppTemplate.includes(requiredFragment)) {
    throw new Error(`The staging Shopify template must retain: ${requiredFragment}`);
  }
}
if (/client_id\s*=\s*"(?!REPLACE_WITH_A_SEPARATE_STAGING_DEV_DASHBOARD_APP_CLIENT_ID")/u.test(stagingAppTemplate)) {
  throw new Error("The staging Shopify template must not contain a real client ID.");
}
const configuredScopes = /^scopes\s*=\s*"([^"]*)"$/mu.exec(stagingAppTemplate)?.[1] ?? "";
if (/(?:read|write)_own_subscription_contracts|write_customers|write_orders|read_all_orders/u.test(configuredScopes)) {
  throw new Error("The staging Shopify template must retain least-privilege initial scopes.");
}

const proxyBridge = readFileSync(resolve(root, "src/shopify-staging/app-proxy-bridge.ts"), "utf8");
if (/\bfetch\s*\(|https?:\/\//u.test(proxyBridge)) {
  throw new Error("The staging App Proxy bridge must remain network-free.");
}

const stagingMigration = readFileSync(resolve(root, "migrations/0001_staging_runtime.sql"), "utf8");
for (const requiredFragment of [
  "unit_price_cents = 1800",
  "profile queue audit is append-only",
  "historical backfill audit is append-only",
]) {
  if (!stagingMigration.includes(requiredFragment)) {
    throw new Error(`The staging migration must retain: ${requiredFragment}`);
  }
}

process.stdout.write("Base Note Core local-only foundation verification passed.\n");
