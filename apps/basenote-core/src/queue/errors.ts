export class QueueServiceError extends Error {
  override name = "QueueServiceError";
}

export class QueueNotFoundError extends QueueServiceError {
  override name = "QueueNotFoundError";
}

export class QueueRevisionConflictError extends QueueServiceError {
  override name = "QueueRevisionConflictError";
}

export class QueueCutoffError extends QueueServiceError {
  override name = "QueueCutoffError";
}

export class QueueLockedError extends QueueServiceError {
  override name = "QueueLockedError";
}

export class QueueIdempotencyConflictError extends QueueServiceError {
  override name = "QueueIdempotencyConflictError";
}
