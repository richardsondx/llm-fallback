/**
 * Stream observation helpers.
 *
 * withFallback passes streams through untouched, which is exactly what you
 * want for latency. These helpers let you attach error/done hooks to a
 * stream without breaking that passthrough.
 */

export interface StreamHooks {
  onError?: (error: unknown) => void;
  onDone?: () => void;
}

/**
 * Wrap a WHATWG ReadableStream so chunks flow through unchanged while
 * onError/onDone observe the stream's fate.
 */
export function observeStream<T>(
  stream: ReadableStream<T>,
  hooks: StreamHooks = {}
): ReadableStream<T> {
  const reader = stream.getReader();
  let done = false;
  return new ReadableStream<T>({
    async pull(controller) {
      try {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) {
          if (!done) {
            done = true;
            hooks.onDone?.();
          }
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        hooks.onError?.(error);
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        reader.releaseLock();
      }
    }
  });
}

/**
 * Wrap an async iterable (Anthropic/OpenAI stream shapes) with error/done
 * hooks. Chunks pass through unchanged.
 */
export async function* observeAsyncIterable<T>(
  iterable: AsyncIterable<T>,
  hooks: StreamHooks = {}
): AsyncIterable<T> {
  try {
    for await (const chunk of iterable) {
      yield chunk;
    }
    hooks.onDone?.();
  } catch (error) {
    hooks.onError?.(error);
    throw error;
  }
}
