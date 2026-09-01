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
  "src/profile-queue/fotm-schedule.ts",
  "src/profile-queue/d1-fotm-schedule-repository.ts",
  "src/profile-queue/ui.ts",
  "src/subscription-history/contracts.ts",
  "src/subscription-history/backfill-importer.ts",
  "src/cloudflare-staging-worker/contracts.ts",
  "src/cloudflare-staging-worker/boundaries.ts",
  "src/cloudflare-staging-worker/http.ts",
  "src/cloudflare-staging-worker/request-validation.ts",
  "src/cloudflare-staging-worker/webcrypto-app-proxy.ts",
  "src/cloudflare-staging-worker/d1-test-binding-resolver.ts",
  "src/cloudflare-staging-worker/form-nonce.ts",
  "src/cloudflare-staging-worker/d1-form-nonce-repository.ts",
  "src/cloudflare-staging-worker/staging-test-variants.ts",
  "src/cloudflare-staging-worker/profile-queue-page.ts",
  "src/cloudflare-staging-worker/cutoff-locker.ts",
  "src/cloudflare-staging-worker/fotm-schedule-admin.ts",
  "src/cloudflare-staging-worker/worker.ts",
  "migrations/0001_staging_runtime.sql",
  "migrations/0002_staging_test_bindings.sql",
  "migrations/0003_member_fragrance_choice.sql",
  "scripts/smoke-member-choice-migration.mjs",
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
if (
  !workerTemplate.includes("STAGING_SHOP_DOMAIN")
  || !workerTemplate.includes("STAGING_TEST_VARIANT_IDS")
  || !workerTemplate.includes("STAGING_CUTOFF_AUTOMATION_ENABLED")
) {
  throw new Error("The Worker template must retain staging-only shop and test-variant configuration.");
}
for (const requiredFragment of [
  "basenote-profile-queue-staging.wilson-af8.workers.dev",
  "https://base-note-subscription-staging.myshopify.com",
  "basenote-staging",
]) {
  if (!workerTemplate.includes(requiredFragment)) {
    throw new Error(`The Worker template must retain its reviewed temporary staging target: ${requiredFragment}`);
  }
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
if (!workerSource.includes('const APP_PROXY_TARGET_PATH = "/api/shopify/app-proxy"')) {
  throw new Error("The Worker must retain the reconciled Shopify App Proxy target path.");
}

const proxyVerifier = readFileSync(resolve(root, "src/cloudflare-staging-worker/webcrypto-app-proxy.ts"), "utf8");
for (const requiredFragment of ["crypto.subtle.verify", "STAGING_SHOP_DOMAIN", "SHOPIFY_APP_PROXY_SHARED_SECRET"]) {
  if (!proxyVerifier.includes(requiredFragment)) {
    throw new Error(`The staging Web Crypto verifier must retain: ${requiredFragment}`);
  }
}

const formNonceSource = readFileSync(resolve(root, "src/cloudflare-staging-worker/d1-form-nonce-repository.ts"), "utf8");
for (const requiredFragment of ["consumed_at IS NULL", "expected_revision = ?", "julianday(expires_at) > julianday(?)"]) {
  if (!formNonceSource.includes(requiredFragment)) {
    throw new Error(`The staging form nonce boundary must retain: ${requiredFragment}`);
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

const testBindingMigration = readFileSync(resolve(root, "migrations/0002_staging_test_bindings.sql"), "utf8");
for (const requiredFragment of [
  "staging_profile_queue_test_bindings",
  "DISPOSABLE_DEVELOPMENT_STORE",
  "expires_at > seeded_at",
  "staging_profile_queue_form_nonces",
  "expected_revision INTEGER NOT NULL",
]) {
  if (!testBindingMigration.includes(requiredFragment)) {
    throw new Error(`The staging test-binding migration must retain: ${requiredFragment}`);
  }
}

const memberChoiceMigration = readFileSync(resolve(root, "migrations/0003_member_fragrance_choice.sql"), "utf8");
for (const requiredFragment of [
  "member_choice_source",
  "profile_queue_selection_evidence",
  "profile_queue_fotm_schedules",
  "America/Chicago",
  "member_choice_source = 'FOTM_FALLBACK'",
  "profile_queue_0003_legacy_preflight",
  "SET state = state",
  "json_each(NEW.add_on_snapshot_json)",
  "strftime('%Y-%m-%dT%H:%M:%S'",
  "|| '.000Z'",
  "'05:01:'",
  "'06:01:'",
  "selection evidence is append-only",
  "FOTM schedule audit is append-only",
]) {
  if (!memberChoiceMigration.includes(requiredFragment)) {
    throw new Error(`The member-choice migration must retain: ${requiredFragment}`);
  }
}

const cutoffLocker = readFileSync(resolve(root, "src/cloudflare-staging-worker/cutoff-locker.ts"), "utf8");
for (const forbiddenFragment of ["fetch(", "APPSTLE", "SHOPIFY_ADMIN", "MAILGUN"]) {
  if (cutoffLocker.includes(forbiddenFragment)) {
    throw new Error(`The cutoff locker must remain D1-only and must not contain ${forbiddenFragment}.`);
  }
}
if (!cutoffLocker.includes("STAGING_CUTOFF_LOCK_BATCH_SIZE = 10")) {
  throw new Error("The staging cutoff locker must retain its ten-cycle subrequest bound.");
}

process.stdout.write("Base Note Core local-only foundation verification passed.\n");
