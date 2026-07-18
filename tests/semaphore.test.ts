import { describe, expect, it } from 'vitest';
import { Semaphore } from '../src/lib/semaphore';

function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Flush microtasks (Semaphore starts tasks on the microtask queue).
const tick = () => new Promise<void>((res) => setTimeout(res, 0));

describe('Semaphore (CONTRACTS §5)', () => {
  it('never runs more than max tasks concurrently', async () => {
    const sem = new Semaphore(2);
    const gate = deferred();
    let started = 0;
    let running = 0;
    let peak = 0;

    const tasks = Array.from({ length: 5 }, () =>
      sem.run(async () => {
        started += 1;
        running += 1;
        peak = Math.max(peak, running);
        await gate.promise;
        running -= 1;
      }),
    );

    await tick();
    expect(started).toBe(2); // 3 remain queued while both slots are held

    gate.resolve();
    await Promise.all(tasks);
    expect(started).toBe(5);
    expect(peak).toBe(2);
  });

  it('starts queued tasks in FIFO order', async () => {
    const sem = new Semaphore(1);
    const gate = deferred();
    const order: number[] = [];

    const first = sem.run(async () => {
      order.push(1);
      await gate.promise;
    });
    const second = sem.run(async () => {
      order.push(2);
    });
    const third = sem.run(async () => {
      order.push(3);
    });

    await tick();
    expect(order).toEqual([1]);

    gate.resolve();
    await Promise.all([first, second, third]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('releases the slot when a task rejects and propagates the rejection', async () => {
    const sem = new Semaphore(1);
    const gate = deferred();
    let queuedStarted = false;

    const rejecting = sem.run(async () => {
      await gate.promise;
      throw new Error('boom');
    });
    const queued = sem.run(async () => {
      queuedStarted = true;
      return 'after';
    });

    await tick();
    expect(queuedStarted).toBe(false);

    gate.resolve();
    await expect(rejecting).rejects.toThrow('boom');
    await expect(queued).resolves.toBe('after');
    expect(queuedStarted).toBe(true);
  });

  it('propagates resolved values', async () => {
    const sem = new Semaphore(2);
    await expect(sem.run(() => Promise.resolve(42))).resolves.toBe(42);
  });
});
