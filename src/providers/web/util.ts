/** `work`, unless the caller cancels (rejects with the abort reason) or it outlasts `ms`. */
export function withDeadline<T>(work: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const stop = () => reject(signal.reason);
    const timer = setTimeout(() => reject(new Error(`No answer from the web within ${ms / 1000} s`)), ms);
    signal.addEventListener("abort", stop, { once: true });
    const settle = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
    };
    work.then(
      (value) => {
        settle();
        resolve(value);
      },
      (error: unknown) => {
        settle();
        reject(error);
      },
    );
  });
}

/** Each site once, without "www.", for "Searched … · superuser.com · learn.microsoft.com". */
export function sourceHosts(urls: string[]): string[] {
  const hosts = urls.flatMap((url) => {
    try {
      return [new URL(url).hostname.replace(/^www\./, "")];
    } catch {
      return [];
    }
  });
  return [...new Set(hosts)];
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
