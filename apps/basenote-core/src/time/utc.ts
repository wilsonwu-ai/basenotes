/**
 * Shared UTC timestamp handling for stateful Base Note domains.
 *
 * Inputs may omit milliseconds, but every accepted value is converted to the
 * one canonical representation (`YYYY-MM-DDTHH:mm:ss.sssZ`). This prevents a
 * lexical ordering difference between equivalent instants such as `...:00Z`
 * and `...:00.000Z` from becoming a business-state decision.
 */

const UTC_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/**
 * Validates an exact UTC instant and returns its canonical millisecond form.
 *
 * Date.parse accepts some impossible calendar dates by normalizing them, so
 * validation includes an exact UTC round trip before the value is accepted.
 */
export function canonicalizeUtcIsoTimestamp(value: string): string {
  if (!UTC_ISO_TIMESTAMP.test(value)) {
    throw new Error("timestamp must be a valid UTC ISO-8601 value.");
  }

  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) {
    throw new Error("timestamp must be a valid UTC ISO-8601 value.");
  }

  const canonical = new Date(milliseconds).toISOString();
  const inputAtMillisecondPrecision = value.includes(".")
    ? value
    : `${value.slice(0, -1)}.000Z`;
  if (canonical !== inputAtMillisecondPrecision) {
    throw new Error("timestamp must be a valid UTC ISO-8601 value.");
  }
  return canonical;
}

/**
 * Compares validated UTC instants numerically. Never sort accepted timestamp
 * strings lexically: whole-second and millisecond forms can name the same
 * instant while having different text order.
 */
export function compareUtcIsoInstants(left: string, right: string): -1 | 0 | 1 {
  const leftMilliseconds = Date.parse(canonicalizeUtcIsoTimestamp(left));
  const rightMilliseconds = Date.parse(canonicalizeUtcIsoTimestamp(right));
  if (leftMilliseconds < rightMilliseconds) return -1;
  if (leftMilliseconds > rightMilliseconds) return 1;
  return 0;
}
