import {
  parseProfileQueueApiRequest,
  type NormalizedProfileQueueApiRequest,
} from "../profile-queue/contracts.js";
import { asCycleKey, asShipMonth } from "../queue/types.js";
import {
  asStagingProfileQueueFormNonce,
  type StagingProfileQueueFormNonce,
} from "./form-nonce.js";

export class ProfileQueueRequestValidationError extends Error {
  override name = "ProfileQueueRequestValidationError";
}

export interface ProfileQueueReadRequest {
  readonly cycleKey: string;
  readonly shipMonth: string;
}

export interface ParsedProfileQueueFormMutationRequest {
  readonly formNonce: StagingProfileQueueFormNonce;
  readonly mutation: NormalizedProfileQueueApiRequest;
}

/** Applies to both the legacy JSON adapter and signed App Proxy form posts. */
export const MAX_PROFILE_QUEUE_REQUEST_BODY_BYTES = 16 * 1024;

/**
 * Browser request parser. It does not allow a browser to choose a contract
 * binding, and creates add-on IDs server-side for ADD_ADD_ON operations.
 */
export async function parseProfileQueueMutationHttpRequest(
  request: Request,
  createOpaqueId: (prefix: "pqa") => string,
): Promise<NormalizedProfileQueueApiRequest> {
  assertJsonContentType(request);
  const body = parseJsonBody(await readBoundedBodyText(request));
  const record = asRecord(body);
  assertExactKeys(record, ["cycleKey", "expectedRevision", "idempotencyKey", "mutation", "shipMonth"]);

  const headerIdempotencyKey = request.headers.get("Idempotency-Key");
  if (headerIdempotencyKey === null || record.idempotencyKey !== headerIdempotencyKey) {
    throw new ProfileQueueRequestValidationError("The idempotency key must match the request header.");
  }

  const mutation = asRecord(record.mutation);
  const sanitizedMutation = sanitizeMutation(mutation, createOpaqueId);
  return parseCoreRequest({ ...record, mutation: sanitizedMutation });
}

/**
 * App Proxy HTML forms cannot attach a custom idempotency header. The server
 * renders a distinct hidden key per form, then validates a narrow URL-encoded
 * shape before adapting it to the same Core contract as the JSON route.
 */
export async function parseProfileQueueMutationFormRequest(
  request: Request,
  createOpaqueId: (prefix: "pqa") => string,
): Promise<ParsedProfileQueueFormMutationRequest> {
  assertFormUrlEncodedContentType(request);
  const fields = readUniqueFormFields(await readBoundedBodyText(request));
  const formNonce = readFormNonce(fields);
  const action = fields.action;
  if (action === "ADD_ADD_ON") {
    assertExactFieldKeys(fields, ["action", "cycleKey", "expectedRevision", "formNonce", "idempotencyKey", "shipMonth", "variantId"]);
    return {
      formNonce,
      mutation: parseCoreRequest({
        cycleKey: requiredFormField(fields, "cycleKey"),
        expectedRevision: readFormRevision(requiredFormField(fields, "expectedRevision")),
        idempotencyKey: requiredFormField(fields, "idempotencyKey"),
        mutation: {
          addOnId: createOpaqueId("pqa"),
          kind: "ADD_ADD_ON",
          variantId: requiredFormField(fields, "variantId"),
        },
        shipMonth: requiredFormField(fields, "shipMonth"),
      }),
    };
  }
  if (action === "REMOVE_ADD_ON") {
    assertExactFieldKeys(fields, ["action", "addOnId", "cycleKey", "expectedRevision", "formNonce", "idempotencyKey", "shipMonth"]);
    return {
      formNonce,
      mutation: parseCoreRequest({
        cycleKey: requiredFormField(fields, "cycleKey"),
        expectedRevision: readFormRevision(requiredFormField(fields, "expectedRevision")),
        idempotencyKey: requiredFormField(fields, "idempotencyKey"),
        mutation: { addOnId: requiredFormField(fields, "addOnId"), kind: "REMOVE_ADD_ON" },
        shipMonth: requiredFormField(fields, "shipMonth"),
      }),
    };
  }
  throw new ProfileQueueRequestValidationError("The profile queue form action is unsupported.");
}

export function parseProfileQueueReadHttpRequest(url: URL): ProfileQueueReadRequest {
  const cycleKey = url.searchParams.get("cycleKey");
  const shipMonth = url.searchParams.get("shipMonth");
  if (!cycleKey || !shipMonth || url.searchParams.getAll("cycleKey").length !== 1 || url.searchParams.getAll("shipMonth").length !== 1) {
    throw new ProfileQueueRequestValidationError("A single cycleKey and shipMonth are required.");
  }
  try {
    return { cycleKey: asCycleKey(cycleKey), shipMonth: asShipMonth(shipMonth) };
  } catch {
    throw new ProfileQueueRequestValidationError("The profile queue read request is invalid.");
  }
}

function sanitizeMutation(
  mutation: Record<string, unknown>,
  createOpaqueId: (prefix: "pqa") => string,
): Record<string, unknown> {
  const kind = mutation.kind;
  if (kind === "ADD_ADD_ON") {
    assertExactKeys(mutation, ["kind", "variantId"]);
    return { addOnId: createOpaqueId("pqa"), kind, variantId: mutation.variantId };
  }
  if (kind === "CHANGE_ADD_ON") {
    assertExactKeys(mutation, ["addOnId", "kind", "variantId"]);
    return mutation;
  }
  if (kind === "REMOVE_ADD_ON") {
    assertExactKeys(mutation, ["addOnId", "kind"]);
    return mutation;
  }
  throw new ProfileQueueRequestValidationError("The profile queue mutation is unsupported.");
}

function parseCoreRequest(value: Record<string, unknown>): NormalizedProfileQueueApiRequest {
  try {
    return parseProfileQueueApiRequest(value);
  } catch {
    throw new ProfileQueueRequestValidationError("The profile queue request is invalid.");
  }
}

function assertJsonContentType(request: Request): void {
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ProfileQueueRequestValidationError("Expected an application/json request.");
  }
}

function assertFormUrlEncodedContentType(request: Request): void {
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw new ProfileQueueRequestValidationError("Expected an URL-encoded form request.");
  }
}

async function readBoundedBodyText(request: Request): Promise<string> {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (
      !/^\d+$/.test(declaredLength)
      || !Number.isSafeInteger(parsedLength)
      || parsedLength > MAX_PROFILE_QUEUE_REQUEST_BODY_BYTES
    ) {
      await cancelUnreadRequestBody(request);
      throw new ProfileQueueRequestValidationError("The request body is too large.");
    }
  }

  const body = request.body;
  if (body === null) {
    throw new ProfileQueueRequestValidationError("The request body is required.");
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value) continue;
      byteLength += next.value.byteLength;
      if (byteLength > MAX_PROFILE_QUEUE_REQUEST_BODY_BYTES) {
        await cancelReader(reader);
        throw new ProfileQueueRequestValidationError("The request body is too large.");
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof ProfileQueueRequestValidationError) throw error;
    await cancelReader(reader);
    throw new ProfileQueueRequestValidationError("The request body could not be read.");
  } finally {
    reader.releaseLock();
  }

  return new TextDecoder().decode(concatenateChunks(chunks, byteLength));
}

function parseJsonBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ProfileQueueRequestValidationError("The request body is not valid JSON.");
  }
}

function readUniqueFormFields(body: string): Record<string, string> {
  const parameters = new URLSearchParams(body);
  const fields: Record<string, string> = {};
  for (const [key, value] of parameters) {
    if (Object.hasOwn(fields, key)) {
      throw new ProfileQueueRequestValidationError("The form contains duplicate fields.");
    }
    fields[key] = value;
  }
  return fields;
}

function assertExactFieldKeys(fields: Record<string, string>, allowedKeys: readonly string[]): void {
  assertExactKeys(fields, allowedKeys);
  if (allowedKeys.some((key) => fields[key] === undefined || fields[key] === "")) {
    throw new ProfileQueueRequestValidationError("The form is incomplete.");
  }
}

function readFormRevision(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new ProfileQueueRequestValidationError("The form revision is invalid.");
  }
  const revision = Number(value);
  if (!Number.isSafeInteger(revision)) {
    throw new ProfileQueueRequestValidationError("The form revision is invalid.");
  }
  return revision;
}

function readFormNonce(fields: Record<string, string>): StagingProfileQueueFormNonce {
  try {
    return asStagingProfileQueueFormNonce(requiredFormField(fields, "formNonce"));
  } catch {
    throw new ProfileQueueRequestValidationError("The Profile Queue form nonce is invalid.");
  }
}

function requiredFormField(fields: Record<string, string>, key: string): string {
  const value = fields[key];
  if (value === undefined || value === "") {
    throw new ProfileQueueRequestValidationError("The form is incomplete.");
  }
  return value;
}

async function cancelUnreadRequestBody(request: Request): Promise<void> {
  try {
    await request.body?.cancel();
  } catch {
    // A cancellation failure must not change a safe request rejection into an
    // uncaught Worker exception or result in an error-body disclosure.
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // See cancelUnreadRequestBody: rejection still wins if a transport abort
    // races the explicit cancellation.
  }
}

function concatenateChunks(chunks: readonly Uint8Array[], byteLength: number): Uint8Array {
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProfileQueueRequestValidationError("The request body must be an object.");
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, allowedKeys: readonly string[]): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new ProfileQueueRequestValidationError("The request contains unsupported fields.");
  }
}
