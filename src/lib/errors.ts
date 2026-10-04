import { isTauri } from "@tauri-apps/api/core";
import { error as logError } from "@tauri-apps/plugin-log";

const LOG_WRITE_FAILED = "couldn't write to Hodeum's log file";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Best effort: copies an error line into Hodeum's log file. A failed write stays in the console. */
function writeToLogFile(line: string): void {
  if (!isTauri()) return;
  try {
    logError(line).catch((failure: unknown) => console.warn(LOG_WRITE_FAILED, failure));
  } catch (failure) {
    console.warn(LOG_WRITE_FAILED, failure);
  }
}

/** Returns a rejection handler that logs with context instead of swallowing the error. */
export function reportError(context: string): (error: unknown) => void {
  return (error) => {
    console.error(context, error);
    writeToLogFile(`${context}: ${errorMessage(error)}`);
  };
}
