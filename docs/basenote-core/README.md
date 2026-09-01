# Base Note Core App

This directory is the implementation and release record for Base Note's
Shopify-integrated operations app. The goal is to make Base Note—not theme
JavaScript or a broad automatic discount—the authority for customer queue
intent and checkout eligibility.

## Delivery boundary

The work is deliberately split into independent phases:

1. **Pricing Guard** — server-side checkout eligibility and exact add-on
   pricing while Appstle continues to own current subscription contracts.
2. **Queue v2** — contract-scoped queue intent, audit history, and a real
   Fragrance-of-the-Month (FOTM) resolver. It can mutate an Appstle contract
   only through a supported, server-to-server Appstle adapter that verifies an
   exact contract and line.
3. **Base Note subscriptions** — a separate subscription app that owns new
   Shopify subscription contracts. Existing Appstle contracts are migrated
   only through a tested, explicitly approved plan.

## Non-negotiable safety rules

- Do not uninstall Appstle during this work. Subscription contracts are owned
  by their creating app; an uninstall can cancel still-active Appstle
  contracts.
- Never use Shopify `*_own_subscription_contracts` scopes to attempt to edit
  Appstle-owned contracts. They are intentionally ownership-scoped.
- Do not put Shopify, Appstle, Cloudflare, customer, payment, or webhook
  secrets in this repository, a theme, browser storage, or a ticket.
- Keep new Functions disabled/config-gated until disposable-customer checkout
  and renewal tests pass.
- Keep all live pricing, contract migration, billing, and app-version
  publication behind an explicit merchant approval.

Read [architecture-and-rollout.md](architecture-and-rollout.md) before
connecting the local app to Shopify or Cloudflare.

Use [decision-log.md](decision-log.md) to track the merchant choices and
evidence required before a production release.
