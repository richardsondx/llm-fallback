import { describe, expect, it, vi } from "vitest";
import { observeStream, observeAsyncIterable } from "../src/stream.js";

function makeStream(chunks: string[], failAt?: number): ReadableStream<string> {
  let i = 0;
  return new ReadableStream<string>({
    pull(controller) {
      if (failAt !== undefined && i === failAt) {
        controller.error(new Error("mid-stream boom"));
        return;
      }
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[i] as string);
      i++;
    }
  });
}

async function collect<T>(stream: ReadableStream<T>): Promise<T[]> {
  const out: T[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out.push(value);
  }
  reader.releaseLock();
  return out;
}

describe("observeStream", () => {
  it("forwards chunks unchanged and calls onDone", async () => {
    const onDone = vi.fn();
    const onError = vi.fn();
    const wrapped = observeStream(makeStream(["a", "b", "c"]), { onDone, onError });
    expect(await collect(wrapped)).toEqual(["a", "b", "c"]);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("calls onError on mid-stream failure and rethrows to the reader", async () => {
    const onError = vi.fn();
    const wrapped = observeStream(makeStream(["a", "b"], 1), { onError });
    await expect(collect(wrapped)).rejects.toThrow("mid-stream boom");
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("observeAsyncIterable", () => {
  async function* gen() {
    yield 1;
    yield 2;
  }
  async function* failingGen(): AsyncIterable<number> {
    yield 1;
    throw new Error("gen boom");
  }

  it("yields everything and calls onDone", async () => {
    const onDone = vi.fn();
    const seen: number[] = [];
    for await (const x of observeAsyncIterable(gen(), { onDone })) seen.push(x);
    expect(seen).toEqual([1, 2]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("calls onError and rethrows", async () => {
    const onError = vi.fn();
    await expect(async () => {
      for await (const _ of observeAsyncIterable(failingGen(), { onError })) {
        // drain
      }
    }).rejects.toThrow("gen boom");
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
