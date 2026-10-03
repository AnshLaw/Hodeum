export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Returns a rejection handler that logs with context instead of swallowing the error. */
export function reportError(context: string): (error: unknown) => void {
  return (error) => console.error(context, error);
}
