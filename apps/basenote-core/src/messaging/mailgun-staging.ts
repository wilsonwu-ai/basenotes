import type { MessageIntent } from "./contracts.js";
import type { RecordedMessagingEvent } from "./events.js";

/**
 * This is a deliberately narrow, test-only Mailgun transport boundary.
 *
 * It is not wired into a Worker, scheduler, webhook, storefront route, or
 * outbox dispatcher. Constructing it requires an explicit staging runtime
 * configuration, and every attempted recipient must match a manually reviewed
 * allow-list. The adapter never imports profiles, resolves recipients, writes
 * outbox state, or logs delivery data.
 */

const MAILGUN_API_HOSTS = new Set(["api.mailgun.net", "api.eu.mailgun.net"]);
const PRODUCTION_BRAND_DOMAIN = "basenotescent.com";
const MAX_SUBJECT_LENGTH = 180;
const MAX_TEXT_LENGTH = 100_000;
const MAX_HTML_LENGTH = 500_000;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/;
const SAFE_PROVIDER_MESSAGE_ID = /^[A-Za-z0-9@._:+/=<>-]{3,255}$/;
const APPROVED_STAGING_CONFIGS = new WeakMap<
  MailgunStagingTransportConfig,
  MailgunStagingTransportConfig
>();

export type MailgunStagingDeliveryMode = "SIMULATE" | "ALLOWLISTED_DELIVERY";

export interface RuntimeEnvironment {
  readonly [key: string]: string | undefined;
}

export interface MailgunStagingTransportConfig {
  /** Always exactly staging; this type is intentionally not reusable for prod. */
  readonly runtimeStage: "staging";
  /** Checked only to prevent a production-facing Worker host from enabling this adapter. */
  readonly stagingAppOrigin: string;
  readonly apiBaseUrl: string;
  readonly apiKey: string;
  readonly deliveryMode: MailgunStagingDeliveryMode;
  readonly sendingDomain: string;
  readonly from: string;
  readonly allowedRecipientAddresses: ReadonlySet<string>;
  readonly allowedRecipientDomains: ReadonlySet<string>;
}

/**
 * The only point at which an address is allowed into the delivery boundary.
 * It is intentionally paired with the same opaque profile ID as the claimed
 * outbox record, so a caller cannot silently retarget an existing intent.
 */
export interface ResolvedStagingRecipient {
  readonly profileId: string;
  readonly email: string;
}

/** Rendered content is transient input; this module never persists it. */
export interface RenderedStagingEmail {
  readonly subject: string;
  readonly text: string;
  readonly html?: string | null;
}

/**
 * A send always needs both durable, opaque records. The transport checks that
 * they refer to the exact same profile and event before it can form a request.
 */
export interface MailgunStagingDeliveryInput {
  readonly event: RecordedMessagingEvent;
  readonly outbox: MessageIntent;
  readonly recipient: ResolvedStagingRecipient;
  readonly rendered: RenderedStagingEmail;
}

export interface MailgunStagingDeliveryResult {
  /** Opaque delivery correlation; never a recipient address. */
  readonly deliveryKey: string;
  /** Mailgun's response ID, returned to the caller for a durable audit update. */
  readonly providerMessageId: string;
  /** Lets a caller record whether Mailgun was asked to simulate or deliver. */
  readonly mode: MailgunStagingDeliveryMode;
}

export type MailgunFetch = (input: URL | string, init?: RequestInit) => Promise<Response>;

export interface MailgunStagingTransportOptions {
  /** Injectable only to make unit tests network-free. Defaults to global fetch. */
  readonly fetch?: MailgunFetch;
}

export type MailgunStagingConfigurationErrorCode =
  | "staging_not_enabled"
  | "unsafe_staging_origin"
  | "missing_secret"
  | "invalid_api_base_url"
  | "unsafe_sending_domain"
  | "unsafe_sender"
  | "missing_recipient_allowlist"
  | "invalid_recipient_allowlist"
  | "invalid_delivery_mode";

export class MailgunStagingConfigurationError extends Error {
  override name = "MailgunStagingConfigurationError";

  constructor(
    readonly code: MailgunStagingConfigurationErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type MailgunStagingDeliveryErrorCode =
  | "invalid_delivery_envelope"
  | "outbox_not_claimed"
  | "event_mismatch"
  | "profile_mismatch"
  | "recipient_not_allowlisted"
  | "invalid_rendered_content"
  | "network_failed"
  | "provider_rejected"
  | "invalid_provider_response";

/**
 * Messages intentionally omit recipient, provider response body, URL, and
 * credentials. Route code should translate these to a generic audited status.
 */
export class MailgunStagingDeliveryError extends Error {
  override name = "MailgunStagingDeliveryError";

  constructor(
    readonly code: MailgunStagingDeliveryErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Reads the only supported Mailgun configuration. Omission is a hard disable;
 * there is no implicit development, production, or provider-default mode.
 */
export function readMailgunStagingTransportConfig(
  environment: RuntimeEnvironment,
): MailgunStagingTransportConfig {
  if (
    read(environment, "BASENOTE_RUNTIME_STAGE") !== "staging"
    || read(environment, "BASENOTE_MAILGUN_STAGING_ENABLED") !== "true"
    || read(environment, "BASENOTE_MAILGUN_TEST_ONLY") !== "true"
  ) {
    throw new MailgunStagingConfigurationError(
      "staging_not_enabled",
      "Mailgun transport is disabled unless the explicit staging-only runtime gates are enabled.",
    );
  }

  const stagingAppOrigin = parseStagingAppOrigin(required(environment, "BASENOTE_STAGING_APP_ORIGIN"));
  const apiBaseUrl = parseMailgunApiBaseUrl(required(environment, "BASENOTE_MAILGUN_API_BASE_URL"));
  const apiKey = requiredSecret(environment, "BASENOTE_MAILGUN_API_KEY");
  const deliveryMode = parseDeliveryMode(required(environment, "BASENOTE_MAILGUN_TEST_DELIVERY_MODE"));
  const sendingDomain = parseTestSendingDomain(required(environment, "BASENOTE_MAILGUN_TEST_DOMAIN"));
  const from = parseFromAddress(required(environment, "BASENOTE_MAILGUN_TEST_FROM"), sendingDomain);
  const allowedRecipientAddresses = parseRecipientAddresses(
    read(environment, "BASENOTE_MAILGUN_TEST_RECIPIENTS"),
  );
  const allowedRecipientDomains = parseRecipientDomains(
    read(environment, "BASENOTE_MAILGUN_TEST_RECIPIENT_DOMAINS"),
  );

  if (allowedRecipientAddresses.size === 0 && allowedRecipientDomains.size === 0) {
    throw new MailgunStagingConfigurationError(
      "missing_recipient_allowlist",
      "Mailgun staging transport requires at least one approved test recipient address or domain.",
    );
  }

  const config = Object.freeze({
    runtimeStage: "staging" as const,
    stagingAppOrigin,
    apiBaseUrl,
    apiKey,
    deliveryMode,
    sendingDomain,
    from,
    allowedRecipientAddresses,
    allowedRecipientDomains,
  });
  // Keep a private snapshot. `ReadonlySet` is a TypeScript-only guarantee, so
  // the adapter must not rely on a caller's returned Set remaining unchanged.
  const internalConfig = Object.freeze({
    ...config,
    allowedRecipientAddresses: new Set(allowedRecipientAddresses),
    allowedRecipientDomains: new Set(allowedRecipientDomains),
  });
  APPROVED_STAGING_CONFIGS.set(config, internalConfig);
  return config;
}

/**
 * Minimal Mailgun v3 messages adapter. It does not alter durable outbox state:
 * the caller must record a verified result before marking a claimed intent sent.
 */
export class MailgunStagingTransport {
  private readonly config: MailgunStagingTransportConfig;
  private readonly fetchImplementation: MailgunFetch;

  constructor(
    config: MailgunStagingTransportConfig,
    options: MailgunStagingTransportOptions = {},
  ) {
    const approvedConfig = APPROVED_STAGING_CONFIGS.get(config);
    if (!approvedConfig || approvedConfig.runtimeStage !== "staging") {
      throw new MailgunStagingConfigurationError(
        "staging_not_enabled",
        "Mailgun transport may only be constructed for the staging runtime.",
      );
    }
    this.config = approvedConfig;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImplementation !== "function") {
      throw new MailgunStagingConfigurationError(
        "staging_not_enabled",
        "A staging transport requires an explicit fetch implementation.",
      );
    }
  }

  async deliver(input: MailgunStagingDeliveryInput): Promise<MailgunStagingDeliveryResult> {
    const envelope = validateEnvelope(input);
    let recipient: string;
    try {
      recipient = normalizeEmailAddress(input.recipient.email);
    } catch {
      throw new MailgunStagingDeliveryError(
        "recipient_not_allowlisted",
        "The resolved staging recipient is not in the approved test allow-list.",
      );
    }
    if (!isRecipientAllowed(recipient, this.config)) {
      throw new MailgunStagingDeliveryError(
        "recipient_not_allowlisted",
        "The resolved staging recipient is not in the approved test allow-list.",
      );
    }
    const rendered = validateRenderedContent(input.rendered);
    const requestUrl = new URL(
      `/v3/${encodeURIComponent(this.config.sendingDomain)}/messages`,
      this.config.apiBaseUrl,
    );
    const form = buildMailgunForm({ config: this.config, envelope, recipient, rendered });

    let response: Response;
    try {
      response = await this.fetchImplementation(requestUrl, {
        body: form,
        headers: {
          Authorization: `Basic ${encodeBasicAuth(`api:${this.config.apiKey}`)}`,
          "X-BaseNote-Staging-Delivery-Key": envelope.outbox.idempotencyKey,
        },
        method: "POST",
      });
    } catch {
      throw new MailgunStagingDeliveryError(
        "network_failed",
        "The staging Mailgun transport did not receive a provider response.",
      );
    }

    if (!response.ok) {
      throw new MailgunStagingDeliveryError(
        "provider_rejected",
        "The staging Mailgun provider rejected the delivery request.",
      );
    }

    const providerMessageId = await readProviderMessageId(response);
    return Object.freeze({
      deliveryKey: envelope.outbox.idempotencyKey,
      providerMessageId,
      mode: this.config.deliveryMode,
    });
  }
}

interface ValidatedEnvelope {
  readonly event: RecordedMessagingEvent;
  readonly outbox: MessageIntent;
}

function validateEnvelope(input: MailgunStagingDeliveryInput): ValidatedEnvelope {
  if (!input || typeof input !== "object" || !input.event || !input.outbox || !input.recipient) {
    throw new MailgunStagingDeliveryError(
      "invalid_delivery_envelope",
      "A claimed opaque outbox record, recorded event, and resolved recipient are required.",
    );
  }
  if (input.outbox.status !== "CLAIMED") {
    throw new MailgunStagingDeliveryError(
      "outbox_not_claimed",
      "Only a separately claimed outbox record can reach the staging transport.",
    );
  }
  if (!OPAQUE_ID.test(input.outbox.id) || !OPAQUE_ID.test(input.outbox.idempotencyKey)) {
    throw new MailgunStagingDeliveryError(
      "invalid_delivery_envelope",
      "The outbox record does not contain valid opaque identifiers.",
    );
  }
  if (!OPAQUE_ID.test(input.event.eventId)) {
    throw new MailgunStagingDeliveryError(
      "invalid_delivery_envelope",
      "The event record does not contain a valid opaque identifier.",
    );
  }
  if (input.outbox.eventId !== input.event.eventId) {
    throw new MailgunStagingDeliveryError(
      "event_mismatch",
      "The claimed outbox record does not refer to the supplied event.",
    );
  }
  if (
    input.outbox.profileId !== input.event.profileId
    || input.outbox.profileId !== input.recipient.profileId
  ) {
    throw new MailgunStagingDeliveryError(
      "profile_mismatch",
      "The claimed outbox, recorded event, and recipient do not refer to one profile.",
    );
  }
  return { event: input.event, outbox: input.outbox };
}

function validateRenderedContent(input: RenderedStagingEmail): RenderedStagingEmail {
  if (!input || typeof input !== "object") {
    throw new MailgunStagingDeliveryError("invalid_rendered_content", "Rendered staging content is required.");
  }
  if (!isSafeHeaderValue(input.subject, MAX_SUBJECT_LENGTH) || !isSafeBody(input.text, MAX_TEXT_LENGTH)) {
    throw new MailgunStagingDeliveryError(
      "invalid_rendered_content",
      "Rendered staging content does not meet the transport safety limits.",
    );
  }
  if (input.html !== undefined && input.html !== null && !isSafeBody(input.html, MAX_HTML_LENGTH)) {
    throw new MailgunStagingDeliveryError(
      "invalid_rendered_content",
      "Rendered staging content does not meet the transport safety limits.",
    );
  }
  return {
    subject: input.subject,
    text: input.text,
    html: input.html ?? null,
  };
}

function buildMailgunForm(input: {
  readonly config: MailgunStagingTransportConfig;
  readonly envelope: ValidatedEnvelope;
  readonly recipient: string;
  readonly rendered: RenderedStagingEmail;
}): FormData {
  const form = new FormData();
  form.set("from", input.config.from);
  form.set("to", input.recipient);
  form.set("subject", input.rendered.subject);
  form.set("text", input.rendered.text);
  if (input.rendered.html) form.set("html", input.rendered.html);
  form.set("o:tracking", "no");
  form.set("o:tracking-clicks", "no");
  form.set("o:tracking-opens", "no");
  form.set("o:require-tls", "yes");
  if (input.config.deliveryMode === "SIMULATE") form.set("o:testmode", "yes");

  // These are opaque correlation references only. No recipient address,
  // profile data, rendered content, or customer attributes enter provider vars.
  form.set("v:basenote_delivery_key", input.envelope.outbox.idempotencyKey);
  form.set("v:basenote_event_id", input.envelope.event.eventId);
  form.set("o:tag", `staging.${input.envelope.outbox.templateKey}`);
  return form;
}

async function readProviderMessageId(response: Response): Promise<string> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new MailgunStagingDeliveryError(
      "invalid_provider_response",
      "The staging Mailgun provider response cannot be correlated safely.",
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new MailgunStagingDeliveryError(
      "invalid_provider_response",
      "The staging Mailgun provider response cannot be correlated safely.",
    );
  }
  const id = (body as Record<string, unknown>).id;
  if (typeof id !== "string" || !SAFE_PROVIDER_MESSAGE_ID.test(id)) {
    throw new MailgunStagingDeliveryError(
      "invalid_provider_response",
      "The staging Mailgun provider response cannot be correlated safely.",
    );
  }
  return id;
}

function read(environment: RuntimeEnvironment, name: string): string | undefined {
  const value = environment[name];
  return typeof value === "string" ? value.trim() : undefined;
}

function required(environment: RuntimeEnvironment, name: string): string {
  const value = read(environment, name);
  if (!value) {
    throw new MailgunStagingConfigurationError(
      "staging_not_enabled",
      "Mailgun staging transport is missing a required non-secret runtime value.",
    );
  }
  return value;
}

function requiredSecret(environment: RuntimeEnvironment, name: string): string {
  const value = read(environment, name);
  if (!value || value.length < 8 || !/^[\x21-\x7E]+$/.test(value)) {
    throw new MailgunStagingConfigurationError(
      "missing_secret",
      "Mailgun staging transport requires a runtime-only API credential.",
    );
  }
  return value;
}

function parseStagingAppOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MailgunStagingConfigurationError(
      "unsafe_staging_origin",
      "Mailgun staging transport requires a safe staging application origin.",
    );
  }
  const host = url.hostname.toLowerCase();
  // A temporary Workers.dev hostname is allowed only when its Worker name
  // itself carries the `-staging` suffix. That lets the isolated development
  // store run before Base Note has delegated a branded staging DNS zone,
  // without accepting a production-facing Workers.dev host.
  const safeWorkerHost = /^[a-z0-9-]*-staging\.[a-z0-9-]+\.workers\.dev$/.test(host);
  const safeHost = host.startsWith("app-staging.") || host.includes(".staging.") || safeWorkerHost;
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
    || !safeHost
  ) {
    throw new MailgunStagingConfigurationError(
      "unsafe_staging_origin",
      "Mailgun staging transport refuses a production-facing or malformed application origin.",
    );
  }
  return url.origin;
}

function parseMailgunApiBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MailgunStagingConfigurationError(
      "invalid_api_base_url",
      "Mailgun staging transport requires an approved HTTPS API endpoint.",
    );
  }
  if (
    url.protocol !== "https:"
    || !MAILGUN_API_HOSTS.has(url.hostname.toLowerCase())
    || url.port !== ""
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
  ) {
    throw new MailgunStagingConfigurationError(
      "invalid_api_base_url",
      "Mailgun staging transport requires an approved HTTPS API endpoint.",
    );
  }
  return url.origin;
}

function parseDeliveryMode(value: string): MailgunStagingDeliveryMode {
  if (value === "SIMULATE" || value === "ALLOWLISTED_DELIVERY") return value;
  throw new MailgunStagingConfigurationError(
    "invalid_delivery_mode",
    "Mailgun staging transport requires an explicit safe test delivery mode.",
  );
}

function parseTestSendingDomain(value: string): string {
  const domain = normalizeDomain(value);
  const isSandbox = /^sandbox[a-z0-9-]+\.mailgun\.org$/.test(domain);
  const isDedicatedStagingDomain = domain === `mail-staging.${PRODUCTION_BRAND_DOMAIN}`;
  if (!isSandbox && !isDedicatedStagingDomain) {
    throw new MailgunStagingConfigurationError(
      "unsafe_sending_domain",
      "Mailgun staging transport accepts only a sandbox or explicitly staging-only sender domain.",
    );
  }
  return domain;
}

function parseFromAddress(value: string, expectedDomain: string): string {
  const address = normalizeEmailAddress(value);
  if (domainForEmail(address) !== expectedDomain) {
    throw new MailgunStagingConfigurationError(
      "unsafe_sender",
      "The staging sender must be an address at the configured test sending domain.",
    );
  }
  return address;
}

function parseRecipientAddresses(value: string | undefined): ReadonlySet<string> {
  const addresses = new Set<string>();
  for (const entry of splitAllowlist(value)) {
    try {
      const address = normalizeEmailAddress(entry);
      if (isProductionBrandDomain(domainForEmail(address))) {
        throw new Error("Production brand recipient addresses are not allowed in staging.");
      }
      addresses.add(address);
    } catch {
      throw new MailgunStagingConfigurationError(
        "invalid_recipient_allowlist",
        "The staging recipient address allow-list contains an invalid entry.",
      );
    }
  }
  return addresses;
}

function parseRecipientDomains(value: string | undefined): ReadonlySet<string> {
  const domains = new Set<string>();
  for (const entry of splitAllowlist(value)) {
    let domain: string;
    try {
      domain = normalizeDomain(entry);
    } catch {
      throw new MailgunStagingConfigurationError(
        "invalid_recipient_allowlist",
        "The staging recipient domain allow-list contains an invalid entry.",
      );
    }
    if (isProductionBrandDomain(domain)) {
      throw new MailgunStagingConfigurationError(
        "invalid_recipient_allowlist",
        "A production brand domain cannot be used as a broad staging recipient allow-list entry.",
      );
    }
    domains.add(domain);
  }
  return domains;
}

function isProductionBrandDomain(domain: string): boolean {
  return domain === PRODUCTION_BRAND_DOMAIN || domain.endsWith(`.${PRODUCTION_BRAND_DOMAIN}`);
}

function splitAllowlist(value: string | undefined): string[] {
  if (!value) return [];
  const entries = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (entries.length !== new Set(entries.map((entry) => entry.toLowerCase())).size) {
    throw new MailgunStagingConfigurationError(
      "invalid_recipient_allowlist",
      "The staging recipient allow-list contains duplicate entries.",
    );
  }
  return entries;
}

function normalizeEmailAddress(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > 254 || /[\r\n<>\s]/.test(trimmed)) {
    throw new Error("Invalid email address.");
  }
  const separator = trimmed.lastIndexOf("@");
  if (separator <= 0 || separator === trimmed.length - 1 || trimmed.indexOf("@") !== separator) {
    throw new Error("Invalid email address.");
  }
  const local = trimmed.slice(0, separator);
  if (local.length > 64 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) {
    throw new Error("Invalid email address.");
  }
  return `${local.toLowerCase()}@${normalizeDomain(trimmed.slice(separator + 1))}`;
}

function domainForEmail(email: string): string {
  const separator = email.lastIndexOf("@");
  return email.slice(separator + 1);
}

function normalizeDomain(value: string): string {
  const domain = value.trim().toLowerCase();
  if (domain.length === 0 || domain.length > 253 || domain.endsWith(".")) {
    throw new Error("Invalid domain.");
  }
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error("Invalid domain.");
  }
  return domain;
}

function isRecipientAllowed(recipient: string, config: MailgunStagingTransportConfig): boolean {
  return config.allowedRecipientAddresses.has(recipient)
    || config.allowedRecipientDomains.has(domainForEmail(recipient));
}

function isSafeHeaderValue(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxLength
    && !/[\r\n\u0000]/.test(value);
}

function isSafeBody(value: unknown, maxLength: number): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maxLength
    && !/\u0000/.test(value);
}

function encodeBasicAuth(value: string): string {
  if (typeof globalThis.btoa !== "function") {
    throw new MailgunStagingDeliveryError(
      "network_failed",
      "The staging runtime cannot encode provider authentication safely.",
    );
  }
  return globalThis.btoa(value);
}
