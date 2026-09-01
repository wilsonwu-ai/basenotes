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
  "src/cloudflare-staging-worker/contracts.ts",
  "src/cloudflare-staging-worker/boundaries.ts",
  "src/cloudflare-staging-worker/http.ts",
  "src/cloudflare-staging-worker/request-validation.ts",
  "src/cloudflare-staging-worker/worker.ts",
  "migrations/0001_staging_runtime.sql",
  "wrangler.staging.example.toml",
  "tsconfig.worker.json",
  "src/platform/subscription-gateway.ts",
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

const workerTemplate = readFileSync(resolve(root, "wrangler.staging.example.toml"), "utf8");
if (!workerTemplate.includes('name = "basenote-profile-queue-staging"')) {
  throw new Error("The Worker template must retain its explicit staging-only name.");
}
if (/^account_id\s*=/m.test(workerTemplate) || /^\s*route\s*=/m.test(workerTemplate)) {
  throw new Error("The Worker template must not contain an account ID or a live route.");
}
if (/^[A-Z][A-Z0-9_]*SECRET[A-Z0-9_]*\s*=/m.test(workerTemplate)) {
  throw new Error("The Worker template must not contain a secret value.");
}

const workerSource = readFileSync(resolve(root, "src/cloudflare-staging-worker/worker.ts"), "utf8");
for (const forbiddenFragment of ["console.", "fetch(\"https://", "MAILGUN", "SHOPIFY_ADMIN"]) {
  if (workerSource.includes(forbiddenFragment)) {
    throw new Error(`The staging Worker must not contain ${forbiddenFragment}.`);
  }
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
