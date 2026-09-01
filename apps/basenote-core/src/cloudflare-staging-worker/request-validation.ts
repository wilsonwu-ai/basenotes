import {
  parseProfileQueueApiRequest,
  type NormalizedProfileQueueApiRequest,
} from "../profile-queue/contracts.js";
import { asCycleKey, asShipMonth } from "../queue/types.js";

export class ProfileQueueRequestValidationError extends Error {
  override name = "ProfileQueueRequestValidationError";
}

export interface ProfileQueueReadRequest {
  readonly cycleKey: string;
  readonly shipMonth: string;
}

const MAX_JSON_BODY_BYTES = 16 * 1024;

/**
 * Browser request parser. It does not allow a browser to choose a contract
 * binding, and creates add-on IDs server-side for ADD_ADD_ON operations.
 */
export async function parseProfileQueueMutationHttpRequest(
  request: Request,
  createOpaqueId: (prefix: "pqa") => string,
): Promise<NormalizedProfileQueueApiRequest> {
  assertJsonContentType(request);
  const body = await readBoundedJsonBody(request);
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

async function readBoundedJsonBody(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_JSON_BODY_BYTES)) {
    throw new ProfileQueueRequestValidationError("The request body is too large.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw new ProfileQueueRequestValidationError("The request body is too large.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProfileQueueRequestValidationError("The request body is not valid JSON.");
  }
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
