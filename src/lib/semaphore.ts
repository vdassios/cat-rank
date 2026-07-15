/**
 * Classic counting semaphore for serializing concurrent async work.
 *
 * Used by {@link validateCat} (max 2) to cap ONNX inference concurrency —
 * MobileNetV2 is memory-heavy and running more than a couple inferences
 * in parallel risks OOM on a small VPS.
 *
 */
export class Semaphore {
  #max: number;
  #running = 0;
  #queue: Array<() => void> = [];

  /**
   * @param max Maximum number of concurrent {@link run} executions.
   */
  constructor(max: number) {
    this.#max = max;
  }

  /**
   * Schedule an async function for execution.
   *
   * If fewer than `max` calls are currently running, `fn` starts immediately.
   * Otherwise it is queued (FIFO) and will start as soon as a slot opens.
   * The slot is released in a `finally` block so it is guaranteed to free
   * on both resolve and reject.
   *
   * @returns A promise that resolves or rejects with the result of `fn`.
   */
  run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#running < this.#max) {
      this.#running++;
      return this.#execute(fn);
    }
    return new Promise<T>((resolve, reject) => {
      this.#queue.push(() => {
        this.#running++;
        this.#execute(fn).then(resolve, reject);
      });
    });
  }

  #execute<T>(fn: () => Promise<T>): Promise<T> {
    return Promise.resolve()
      .then(fn)
      .finally(() => {
        this.#running--;
        if (this.#queue.length > 0) {
          const next = this.#queue.shift()!;
          next();
        }
      });
  }
}
