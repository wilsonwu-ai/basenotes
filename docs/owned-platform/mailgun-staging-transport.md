# Mailgun staging transport runbook

**Status:** code-only, disabled by default. This runbook creates no Mailgun
account, credential, recipient, DNS record, deployment, or email send.

## Boundary

`src/messaging/mailgun-staging.ts` is a tiny Mailgun v3 transport adapter. It
accepts a **claimed** opaque outbox record, its exact recorded event, a
same-profile transient recipient resolution, and transient rendered content. It
does not import profiles, find a recipient, evaluate consent, write outbox
state, retry, send from a storefront request, or log provider payloads.

The adapter is unavailable unless all of these runtime gates are true:

1. `BASENOTE_RUNTIME_STAGE=staging`
2. `BASENOTE_MAILGUN_STAGING_ENABLED=true`
3. `BASENOTE_MAILGUN_TEST_ONLY=true`
4. `BASENOTE_STAGING_APP_ORIGIN` is the exact isolated Worker origin named in
   the reference template. A branded staging host requires a separate review.
5. The sender is a Mailgun sandbox domain and the sender address is at that
   exact domain.
6. At least one manually reviewed test recipient address is allowlisted.

`SIMULATE` is the only mode in this release: it asks Mailgun to process the
request with `o:testmode=yes`, so it is not delivered. Any real delivery,
dedicated sender, or branded staging host needs a new reviewed change.

The reference variable names live in
[`../../apps/basenote-core/mailgun.staging.example.env`](../../apps/basenote-core/mailgun.staging.example.env).
It contains no credential and must not be renamed to an active configuration
file or committed after filling values.

## External blocker: Mailgun account and recipient verification

There is currently no authenticated Base Note Mailgun account session available
to this project. An account owner must log in (or create and activate the
account), accept any provider terms, create a private API key, and add the
named test recipient. The recipient owner must then verify that address before
a sandbox can deliver to it. Those identity, terms, billing, credential, and
inbox-verification actions are external human-owned blockers; this code branch
cannot and does not attempt them.

Mailgun documents that every new account receives a sandbox domain and that it
can send only to authorized recipients. Its setup guide also requires the
recipient to click the verification link before a sandbox send. See Mailgun's
[sandbox-domain guide](https://documentation.mailgun.com/docs/mailgun/user-manual/domains/domains-sandbox)
and [quickstart](https://documentation.mailgun.com/docs/mailgun/quickstart).

## Safe sandbox setup after the owner completes the blocker

1. In Mailgun, use the automatically provisioned sandbox domain. Do **not**
   create, verify, or point a production Base Note domain at Mailgun.
2. Add one or a small number of named internal/disposable test inboxes in the
   Mailgun sandbox UI. Do not upload Shopify, Appstle, Klaviyo, or CSV customer
   lists. Each recipient verifies its own inbox.
3. Create a private Mailgun API key and save it only in the separately approved
   staging secret manager. Never copy it into this repository, a `.env` file,
   storefront JavaScript, Liquid, browser developer tools, WhatsApp, or a pull
   request.
4. Copy only the **names** from the reference template into the staging runtime
   configuration. Keep `BASENOTE_MAILGUN_TEST_DELIVERY_MODE=SIMULATE`.
   List only the exact verified disposable/test inboxes in
   `BASENOTE_MAILGUN_TEST_RECIPIENTS`. The adapter rejects any
   `@basenotescent.com` address or subdomain, even when it is listed exactly.
5. Run the staging Worker only after its durable outbox, consent/suppression
   gate, and audit update are connected and reviewed. The adapter does not make
   those decisions for a caller.
6. Verify a simulated Mailgun response is persisted against the one claimed
   opaque outbox intent. The caller must decide whether a response is sufficient
   to mark it sent; this adapter never does that automatically.
7. Do not attempt an inbox-delivery test through this branch. A separately
   reviewed release must add that capability after the simulation audit has
   passed.

## Dedicated staging sender: later, separate approval

If a sandbox is insufficient, the proposed identity is
`mail-staging.basenotescent.com`, never the root, `hello.`, `notify.`, or a
current production sender. It requires a separate owner approval and a DNS
review first. Add only Mailgun's generated records and do not overwrite Google
Workspace, Shopify, Klaviyo, existing SPF, DKIM, return-path, or DMARC records.
Mailgun's [domain verification guide](https://documentation.mailgun.com/docs/mailgun/user-manual/domains/domains-verify)
describes the generated records; the actual values must be reviewed from the
owner-controlled dashboard at that time.

## Staging exit criteria

- A test-only Worker and database are isolated from production resources.
- The outbox is durable, a claimed item is idempotent, and a human/audited
  dispatcher controls retries. A Mailgun HTTP response is not a substitute for
  consent or outbox state.
- Tests prove a production-facing runtime host, missing secret, non-allowlisted
  recipient, pending outbox, mismatched event/profile, provider failure, and
  invalid provider response all fail closed.
- No subscriber history, Klaviyo profile, Appstle contact, Shopify customer
  export, production sender domain, or production email is used.
- A later end-to-end test uses a disposable Shopify customer and only the
  named Mailgun test inboxes.

Mailgun's [messages API](https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages/post-v3--domain-name--messages)
documents the `/v3/{domain}/messages` request and its `o:testmode` option. This
adapter disables open/click tracking for the staging message and carries only
opaque delivery/event IDs as provider correlation fields.
