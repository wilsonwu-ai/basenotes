import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PROFILE_QUEUE_REQUEST_BODY_BYTES,
  ProfileQueueRequestValidationError,
  parseProfileQueueMutationHttpRequest,
} from "./request-validation.js";

test("streaming parser cancels a chunked body once it exceeds 16 KiB", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_PROFILE_QUEUE_REQUEST_BODY_BYTES + 1));
    },
    cancel() {
      cancelled = true;
    },
  });

  await assert.rejects(
    parseProfileQueueMutationHttpRequest(streamingRequest(stream), () => "pqa_servergenerated001"),
    ProfileQueueRequestValidationError,
  );
  assert.equal(cancelled, true);
});

test("streaming parser cancels before reading a declared oversized body", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const request = streamingRequest(stream, String(MAX_PROFILE_QUEUE_REQUEST_BODY_BYTES + 1));

  await assert.rejects(
    parseProfileQueueMutationHttpRequest(request, () => "pqa_servergenerated001"),
    ProfileQueueRequestValidationError,
  );
  assert.equal(cancelled, true);
});

test("streaming parser does not trust a smaller misreported Content-Length", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_PROFILE_QUEUE_REQUEST_BODY_BYTES + 1));
    },
    cancel() {
      cancelled = true;
    },
  });

  await assert.rejects(
    parseProfileQueueMutationHttpRequest(streamingRequest(stream, "8"), () => "pqa_servergenerated001"),
    ProfileQueueRequestValidationError,
  );
  assert.equal(cancelled, true);
});

function streamingRequest(stream: ReadableStream<Uint8Array>, contentLength?: string): Request {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Idempotency-Key": "pqk_mutation001",
  });
  if (contentLength) headers.set("Content-Length", contentLength);
  return new Request("https://basenote-profile-queue-staging.wilson-af8.workers.dev/api/shopify/app-proxy/profile-queue", {
    body: stream,
    // Node's test Fetch implementation requires this extension for streaming
    // request bodies. Cloudflare ignores it; production source never sets it.
    duplex: "half",
    headers,
    method: "POST",
  } as RequestInit);
}
