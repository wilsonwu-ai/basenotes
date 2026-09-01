import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { renderStagingAdminSchedulerShell } from "./admin-scheduler-page.js";

type BrowserListener = (event?: { preventDefault(): void }) => unknown;

class FakeClassList {
  private readonly values = new Set<string>();

  toggle(value: string, force?: boolean): void {
    if (force === undefined ? !this.values.has(value) : force) this.values.add(value);
    else this.values.delete(value);
  }

  remove(value: string): void {
    this.values.delete(value);
  }
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly classList = new FakeClassList();
  readonly listeners = new Map<string, BrowserListener[]>();
  className = "";
  disabled = false;
  name = "";
  placeholder = "";
  required = false;
  textContent = "";
  type = "";
  value = "";

  constructor(readonly tagName: string) {}

  append(...children: FakeElement[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  addEventListener(type: string, listener: BrowserListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  focus(): void {}
}

interface BrowserRequest {
  readonly body: string | undefined;
  readonly headers: Record<string, string>;
  readonly method: string;
}

interface ResponseStep {
  readonly body?: unknown;
  readonly jsonFailure?: boolean;
  readonly status: number;
}

type QueuedResponseStep = Error | Promise<ResponseStep> | ResponseStep;

class FakeSessionStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const schedulerResult = {
  pendingProvisionCommands: [],
  provisionCommands: [],
  schedules: [],
  variants: [{ label: "Disposable test fragrance", variantId: "gid://shopify/ProductVariant/123" }],
};

const savedDraftResult = {
  replayed: false,
  schedule: { revision: 0, shipMonth: "2026-11", status: "DRAFT" },
};

function response(step: ResponseStep): { ok: boolean; status: number; json(): Promise<unknown> } {
  return {
    ok: step.status >= 200 && step.status < 300,
    status: step.status,
    async json() {
      if (step.jsonFailure) throw new Error("invalid json");
      return step.body;
    },
  };
}

async function schedulerRuntime(
  storage = new FakeSessionStorage(),
  initialResult: unknown = schedulerResult,
): Promise<{
  readonly requests: BrowserRequest[];
  readonly scheduler: FakeElement;
  enqueue(...steps: QueuedResponseStep[]): void;
}> {
  const markup = renderStagingAdminSchedulerShell({
    apiPath: "/api/admin/fotm-schedules",
    clientId: "staging-client-id-123456",
  });
  const scripts = [...markup.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  const source = scripts.at(-1)?.[1];
  assert.ok(source, "inline scheduler script must be present");

  const status = new FakeElement("p");
  const scheduler = new FakeElement("section");
  const requests: BrowserRequest[] = [];
  const steps: QueuedResponseStep[] = [{ status: 200, body: initialResult }];
  let uuidSequence = 0;

  runInNewContext(source, {
    console,
    crypto: {
      randomUUID() {
        uuidSequence += 1;
        return `00000000-0000-4000-8000-${String(uuidSequence).padStart(12, "0")}`;
      },
    },
    document: {
      createElement(name: string) {
        return new FakeElement(name);
      },
      getElementById(id: string) {
        return id === "status" ? status : id === "scheduler" ? scheduler : null;
      },
    },
    fetch: async (_url: string, init: { body?: string; headers: Record<string, string>; method: string }) => {
      requests.push({ body: init.body, headers: init.headers, method: init.method });
      const queuedStep = steps.shift();
      assert.ok(queuedStep, "a queued fake response must exist");
      const step = await queuedStep;
      if (step instanceof Error) throw step;
      return response(step);
    },
    sessionStorage: storage,
    window: {
      confirm: () => true,
      shopify: { idToken: async () => "fresh-staging-id-token" },
    },
  });

  await eventually(() => requests.length === 1 && findElement(scheduler, (node) => node.tagName === "form") !== undefined);
  return { enqueue: (...newSteps) => steps.push(...newSteps), requests, scheduler };
}

function allElements(root: FakeElement): FakeElement[] {
  return [root, ...root.children.flatMap(allElements)];
}

function findElement(root: FakeElement, predicate: (element: FakeElement) => boolean): FakeElement | undefined {
  return allElements(root).find(predicate);
}

function preparedScheduleForm(scheduler: FakeElement): FakeElement {
  const form = findElement(scheduler, (node) => node.tagName === "form");
  assert.ok(form);
  const values = new Map([
    ["shipMonth", "2026-11"],
    ["cutoffAt", "2026-11-10T06:01:00.000Z"],
    ["variantId", "gid://shopify/ProductVariant/123"],
  ]);
  for (const [name, value] of values) {
    const field = findElement(form, (node) => node.name === name);
    assert.ok(field, `${name} field must exist`);
    field.value = value;
  }
  return form;
}

async function dispatch(element: FakeElement, type: string): Promise<void> {
  const listener = element.listeners.get(type)?.[0];
  assert.ok(listener, `${type} listener must exist`);
  await listener({ preventDefault() {} });
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail("scheduler runtime did not settle");
}

function postRequests(requests: readonly BrowserRequest[]): BrowserRequest[] {
  return requests.filter((request) => request.method === "POST");
}

function retryButton(scheduler: FakeElement): FakeElement | undefined {
  return findElement(scheduler, (node) => node.tagName === "button" && node.textContent === "Retry pending request");
}

function deferredResponse(): { readonly promise: Promise<ResponseStep>; resolve(step: ResponseStep): void } {
  let settle: ((step: ResponseStep) => void) | undefined;
  const promise = new Promise<ResponseStep>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve(step) {
      assert.ok(settle);
      settle(step);
    },
  };
}

test("embedded scheduler shell exposes no protected data before a fresh Admin token API call", () => {
  const markup = renderStagingAdminSchedulerShell({
    apiPath: "/api/admin/fotm-schedules",
    clientId: "staging-client-id-123456",
  });

  assert.match(markup, /name="shopify-api-key" content="staging-client-id-123456"/);
  assert.match(markup, /shopify\.idToken\(\)/);
  assert.match(markup, /Authorization: "Bearer " \+ token/);
  assert.match(markup, /Retry pending request/);
  assert.match(markup, /original idempotency key and a fresh Shopify ID token/);
  assert.match(markup, /state\.pending = pending/);
  assert.match(markup, /Only this button resends its exact payload with the original idempotency key/i);
  assert.match(markup, /state\.pending\.payload !== payload/);
  assert.match(markup, /post\(pendingCommand\.command, \{ retry:true \}\)/);
  assert.doesNotMatch(markup, /state\.pending && state\.pending\.fingerprint === fingerprint/);
  assert.match(markup, /Future FOTM scheduler/);
  assert.match(markup, /visibly pre-selected, one included fragrance/i);
  assert.match(markup, /not an add-on/i);
  assert.match(markup, /member may still save a separate override before the Central-time cutoff/i);
  assert.match(markup, /legacy theme FOTM is display-only/i);
  assert.match(markup, /Provision up to five cycles/);
  assert.match(markup, /Retire this month/);
  assert.match(markup, /explicit recovery draft/i);
  assert.match(markup, /Record no-mutation recovery exception/);
  assert.match(markup, /It was not retired or replaced/i);
  assert.match(markup, /provision_recovery_required/);
  assert.match(markup, /Mark pending provision needs attention/);
  assert.match(markup, /pendingProvisionCommands/);
  assert.match(markup, /state\.pendingProvisionCommands\.filter/);
  assert.match(markup, /15-minute recovery delay/);
  assert.match(markup, /will not retry, alter a schedule, or change a shipment/i);
  assert.doesNotMatch(markup, /SHOPIFY_ADMIN_CLIENT_SECRET/);
  assert.doesNotMatch(markup, /staging_admin_id_token_replays/);
  assert.doesNotMatch(markup, /person@example\.test/);
});

test("ambiguous 5xx keeps the exact command body and key for the deliberate retry control", async () => {
  const runtime = await schedulerRuntime();
  runtime.enqueue(
    { status: 503, body: { error: "unavailable" } },
    { status: 200, body: schedulerResult },
  );
  await dispatch(preparedScheduleForm(runtime.scheduler), "submit");

  const retry = retryButton(runtime.scheduler);
  assert.ok(retry, "an ambiguous server response must expose the deliberate retry control");
  const firstAttempt = postRequests(runtime.requests)[0];
  assert.ok(firstAttempt);

  runtime.enqueue({ status: 200, body: schedulerResult });
  await dispatch(preparedScheduleForm(runtime.scheduler), "submit");
  assert.equal(postRequests(runtime.requests).length, 1, "ordinary controls must not resend an uncertain command");

  runtime.enqueue(
    { status: 200, body: savedDraftResult },
    { status: 200, body: schedulerResult },
  );
  const deliberateRetry = retryButton(runtime.scheduler);
  assert.ok(deliberateRetry);
  await dispatch(deliberateRetry, "click");

  const retried = postRequests(runtime.requests)[1];
  assert.ok(retried);
  assert.equal(retried.body, firstAttempt.body);
  assert.equal(retried.headers["Idempotency-Key"], firstAttempt.headers["Idempotency-Key"]);
  assert.equal(retryButton(runtime.scheduler), undefined);
});

test("transport, JSON, and success-contract failures preserve the pending command", async (t) => {
  const scenarios: Array<{ name: string; failure: Error | ResponseStep }> = [
    { name: "transport failure", failure: new Error("connection reset") },
    { name: "invalid success JSON", failure: { status: 200, jsonFailure: true } },
    { name: "malformed success contract", failure: { status: 200, body: {} } },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const runtime = await schedulerRuntime();
      runtime.enqueue(scenario.failure, { status: 200, body: schedulerResult });
      await dispatch(preparedScheduleForm(runtime.scheduler), "submit");

      const retry = retryButton(runtime.scheduler);
      assert.ok(retry);
      const firstAttempt = postRequests(runtime.requests)[0];
      assert.ok(firstAttempt);
      runtime.enqueue(
        { status: 200, body: savedDraftResult },
        { status: 200, body: schedulerResult },
      );
      await dispatch(retry, "click");

      const retried = postRequests(runtime.requests)[1];
      assert.ok(retried);
      assert.equal(retried.body, firstAttempt.body);
      assert.equal(retried.headers["Idempotency-Key"], firstAttempt.headers["Idempotency-Key"]);
    });
  }
});

test("a definitive 4xx clears the pending command so a later submission rotates its key", async () => {
  const runtime = await schedulerRuntime();
  runtime.enqueue(
    { status: 409, jsonFailure: true },
    { status: 200, body: schedulerResult },
  );
  await dispatch(preparedScheduleForm(runtime.scheduler), "submit");

  assert.equal(retryButton(runtime.scheduler), undefined);
  const rejected = postRequests(runtime.requests)[0];
  assert.ok(rejected);

  runtime.enqueue(
    { status: 200, body: savedDraftResult },
    { status: 200, body: schedulerResult },
  );
  await dispatch(preparedScheduleForm(runtime.scheduler), "submit");

  const nextAttempt = postRequests(runtime.requests)[1];
  assert.ok(nextAttempt);
  assert.equal(nextAttempt.body, rejected.body);
  assert.notEqual(nextAttempt.headers["Idempotency-Key"], rejected.headers["Idempotency-Key"]);
});

test("the pending tuple survives a failed refresh and same-tab reload without retaining a bearer token", async () => {
  const storage = new FakeSessionStorage();
  const firstRuntime = await schedulerRuntime(storage);
  firstRuntime.enqueue(
    { status: 503, body: { error: "unavailable" } },
    new Error("refresh also unavailable"),
  );
  await dispatch(preparedScheduleForm(firstRuntime.scheduler), "submit");

  const firstAttempt = postRequests(firstRuntime.requests)[0];
  assert.ok(firstAttempt);
  const retryWithoutRefresh = retryButton(firstRuntime.scheduler);
  assert.ok(retryWithoutRefresh, "the retry control must not depend on the follow-up GET");
  assert.equal(retryWithoutRefresh.disabled, false);
  const stored = storage.getItem("basenote.staging.admin-scheduler.pending.v1");
  assert.ok(stored);
  assert.doesNotMatch(stored, /Bearer|fresh-staging-id-token|Authorization/i);

  const reloadedRuntime = await schedulerRuntime(storage);
  const retry = retryButton(reloadedRuntime.scheduler);
  assert.ok(retry, "a validated pending tuple must be restored in the same tab session");
  reloadedRuntime.enqueue(
    { status: 200, body: savedDraftResult },
    { status: 200, body: schedulerResult },
  );
  await dispatch(retry, "click");

  const retried = postRequests(reloadedRuntime.requests)[0];
  assert.ok(retried);
  assert.equal(retried.body, firstAttempt.body);
  assert.equal(retried.headers["Idempotency-Key"], firstAttempt.headers["Idempotency-Key"]);
  assert.equal(storage.getItem("basenote.staging.admin-scheduler.pending.v1"), null);
});

test("a double-click cannot overlap retries or lose a second ambiguous outcome", async () => {
  const runtime = await schedulerRuntime();
  runtime.enqueue(
    { status: 503, body: { error: "unavailable" } },
    { status: 200, body: schedulerResult },
  );
  await dispatch(preparedScheduleForm(runtime.scheduler), "submit");
  const original = postRequests(runtime.requests)[0];
  assert.ok(original);

  const deferred = deferredResponse();
  runtime.enqueue(deferred.promise, { status: 200, body: schedulerResult });
  const retry = retryButton(runtime.scheduler);
  assert.ok(retry);
  const firstClick = dispatch(retry, "click");
  await eventually(() => postRequests(runtime.requests).length === 2);
  await dispatch(retry, "click");
  assert.equal(postRequests(runtime.requests).length, 2, "the second click must not start a concurrent retry");
  deferred.resolve({ status: 503, body: { error: "still unavailable" } });
  await firstClick;

  const ambiguousRetry = postRequests(runtime.requests)[1];
  assert.ok(ambiguousRetry);
  assert.equal(ambiguousRetry.body, original.body);
  assert.equal(ambiguousRetry.headers["Idempotency-Key"], original.headers["Idempotency-Key"]);
  const repeatedRetry = retryButton(runtime.scheduler);
  assert.ok(repeatedRetry, "a repeated ambiguous outcome must retain the deliberate retry control");
  assert.equal(repeatedRetry.disabled, false);
});

test("server-directed needs-attention recovery uses its fixed provision key and can retry ambiguously", async () => {
  const fixedKey = "pfk_provision_attention001";
  const initialResult = {
    ...schedulerResult,
    pendingProvisionCommands: [{
      expectedScheduleRevision: 1,
      idempotencyKey: fixedKey,
      shipMonth: "2026-10",
      status: "PENDING",
    }],
    schedules: [{
      cutoffAt: "2026-10-10T05:01:00.000Z",
      revision: 1,
      shipMonth: "2026-10",
      status: "PUBLISHED",
      variantId: "gid://shopify/ProductVariant/123",
    }],
  };
  const runtime = await schedulerRuntime(new FakeSessionStorage(), initialResult);
  const attention = findElement(runtime.scheduler, (node) => node.tagName === "button" && node.textContent === "Mark pending provision needs attention");
  assert.ok(attention);
  runtime.enqueue(
    { status: 503, body: { error: "unavailable" } },
    { status: 200, body: initialResult },
  );
  await dispatch(attention, "click");

  const firstAttempt = postRequests(runtime.requests)[0];
  assert.ok(firstAttempt);
  assert.equal(firstAttempt.headers["Idempotency-Key"], fixedKey);
  const retry = retryButton(runtime.scheduler);
  assert.ok(retry);
  runtime.enqueue(
    { status: 200, body: { attention: "PROVISION_NEEDS_ATTENTION_RECORDED", replayed: true } },
    { status: 200, body: { ...initialResult, pendingProvisionCommands: [] } },
  );
  await dispatch(retry, "click");

  const retried = postRequests(runtime.requests)[1];
  assert.ok(retried);
  assert.equal(retried.body, firstAttempt.body);
  assert.equal(retried.headers["Idempotency-Key"], fixedKey);
});
