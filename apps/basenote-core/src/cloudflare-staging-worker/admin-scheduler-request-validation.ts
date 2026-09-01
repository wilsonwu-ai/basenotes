import { asProfileQueueFotmScheduleIdempotencyKey } from "../profile-queue/fotm-schedule.js";
import { asShipMonth } from "../queue/types.js";

const MAX_ADMIN_COMMAND_BODY_BYTES = 8 * 1_024;

export class StagingAdminSchedulerRequestValidationError extends Error {
  override name = "StagingAdminSchedulerRequestValidationError";
}

export type ParsedStagingAdminSchedulerCommand =
  | {
      readonly action: "SAVE_DRAFT";
      readonly cutoffAt: string;
      readonly expectedRevision: number | null;
      readonly idempotencyKey: string;
      readonly merchantTimezone: string;
      readonly shipMonth: string;
      readonly variantId: string;
    }
  | {
      readonly action: "PUBLISH";
      readonly expectedRevision: number;
      readonly idempotencyKey: string;
      readonly shipMonth: string;
    }
  | {
      readonly action: "PROVISION";
      readonly expectedScheduleRevision: number;
      readonly idempotencyKey: string;
      readonly shipMonth: string;
    };

/** Parses only the narrow server-owned embedded Admin scheduler command shape. */
export async function parseStagingAdminSchedulerCommand(
  request: Request,
): Promise<ParsedStagingAdminSchedulerCommand> {
  if (request.method !== "POST" || request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new StagingAdminSchedulerRequestValidationError("The staging Admin scheduler request is invalid.");
  }
  const idempotencyKey = readIdempotencyKey(request.headers.get("Idempotency-Key"));
  const record = await readJsonRecord(request);
  const action = readString(record, "action");
  switch (action) {
    case "SAVE_DRAFT":
      assertOnlyKeys(record, ["action", "cutoffAt", "expectedRevision", "merchantTimezone", "shipMonth", "variantId"]);
      return {
        action,
        cutoffAt: readString(record, "cutoffAt"),
        expectedRevision: readNullableRevision(record, "expectedRevision"),
        idempotencyKey,
        merchantTimezone: readString(record, "merchantTimezone"),
        shipMonth: readShipMonth(record, "shipMonth"),
        variantId: readString(record, "variantId"),
      };
    case "PUBLISH":
      assertOnlyKeys(record, ["action", "expectedRevision", "shipMonth"]);
      return {
        action,
        expectedRevision: readRevision(record, "expectedRevision"),
        idempotencyKey,
        shipMonth: readShipMonth(record, "shipMonth"),
      };
    case "PROVISION":
      assertOnlyKeys(record, ["action", "expectedScheduleRevision", "shipMonth"]);
      return {
        action,
        expectedScheduleRevision: readRevision(record, "expectedScheduleRevision"),
        idempotencyKey,
        shipMonth: readShipMonth(record, "shipMonth"),
      };
    default:
      throw new StagingAdminSchedulerRequestValidationError("The staging Admin scheduler request is invalid.");
  }
}

async function readJsonRecord(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_ADMIN_COMMAND_BODY_BYTES)) {
    throw new StagingAdminSchedulerRequestValidationError("The staging Admin scheduler request is invalid.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new StagingAdminSchedulerRequestValidationError("The staging Admin scheduler request is invalid.");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_ADMIN_COMMAND_BODY_BYTES) {
        await reader.cancel();
        throw new StagingAdminSchedulerRequestValidationError("The staging Admin scheduler request is invalid.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joinChunks(chunks, bytes)));
  } catch {
    throw new StagingAdminSchedulerRequestValidationError("The staging Admin scheduler request is invalid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StagingAdminSchedulerRequestValidationError("The staging Admin scheduler request is invalid.");
  }
  return value as Record<string, unknown>;
}

function joinChunks(chunks: readonly Uint8Array[], bytes: number): Uint8Array {
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function readIdempotencyKey(value: string | null): string {
  if (!value || value.includes(",")) {
    throw new StagingAdminSchedulerRequestValidationError("The staging Admin scheduler request is invalid.");
  }
  try {
    return asProfileQueueFotmScheduleIdempotencyKey(value);
  } catch {
    throw new StagingAdminSchedulerRequestValidationError("The staging Admin scheduler request is invalid.");
  }
}

function assertOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(record).some((key) => !keys.includes(key))) {
    throw new StagingAdminSchedulerRequestValidationError("The staging Admin scheduler request is invalid.");
  }
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new StagingAdminSchedulerRequestValidationError("The staging Admin scheduler request is invalid.");
  }
  return value;
}

function readNullableRevision(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (value === null) return null;
  return assertRevision(value);
}

function readRevision(record: Record<string, unknown>, key: string): number {
  return assertRevision(record[key]);
}

function readShipMonth(record: Record<string, unknown>, key: string): string {
  try {
    return asShipMonth(readString(record, key));
  } catch {
    throw new StagingAdminSchedulerRequestValidationError("The staging Admin scheduler request is invalid.");
  }
}

function assertRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new StagingAdminSchedulerRequestValidationError("The staging Admin scheduler request is invalid.");
  }
  return value as number;
}
