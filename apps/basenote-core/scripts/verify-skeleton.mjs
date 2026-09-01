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

process.stdout.write("Base Note Core local-only foundation verification passed.\n");
