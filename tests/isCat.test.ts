import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeImage } from './helpers';

// Shared mutable state for the hoisted mocks below; reset per test.
const h = vi.hoisted(() => ({
  logits: new Float32Array(1000),
  gate: null as Promise<void> | null,
  runCalls: 0,
  inFlight: 0,
  maxInFlight: 0,
  tensors: [] as Array<{ type: string; dims: number[] }>,
  modelExists: true,
}));

// isCat.ts loads onnxruntime-node lazily via dynamic import — vi.mock
// intercepts that too. The fake session returns h.logits as raw output.
vi.mock('onnxruntime-node', () => {
  class FakeTensor {
    type: string;
    data: Float32Array;
    dims: number[];
    constructor(type: string, data: Float32Array, dims: number[]) {
      this.type = type;
      this.data = data;
      this.dims = dims;
      h.tensors.push({ type, dims });
    }
  }
  return {
    Tensor: FakeTensor,
    InferenceSession: {
      create: async () => ({
        inputNames: ['input'],
        outputNames: ['output'],
        run: async () => {
          h.runCalls += 1;
          h.inFlight += 1;
          h.maxInFlight = Math.max(h.maxInFlight, h.inFlight);
          if (h.gate) await h.gate;
          h.inFlight -= 1;
          return { output: { data: h.logits } };
        },
      }),
    },
  };
});

// The module checks the model path with existsSync before touching ONNX.
// Pretend the model file exists (h.modelExists) without shipping one.
// sharp is untouched: node_modules are externalized, so only our own source
// files see this mock.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const existsSync: typeof actual.existsSync = (p) =>
    String(p).includes('mobilenetv2-cat.onnx') ? h.modelExists : actual.existsSync(p);
  return { ...actual, existsSync, default: { ...actual, existsSync } };
});

// validateCat caches the runtime + session in module state — load a fresh
// copy of the module for every test.
async function loadIsCat() {
  vi.resetModules();
  return import('../src/validation/isCat');
}

beforeEach(() => {
  h.logits = new Float32Array(1000);
  h.gate = null;
  h.runCalls = 0;
  h.inFlight = 0;
  h.maxInFlight = 0;
  h.tensors = [];
  h.modelExists = true;
});

describe('validateCat thresholding (CONTRACTS §5)', () => {
  it('exports CAT_THRESHOLD = 0.20', async () => {
    const { CAT_THRESHOLD } = await loadIsCat();
    expect(CAT_THRESHOLD).toBe(0.2);
  });

  it('returns false when the cat-class sum is below the threshold', async () => {
    // All-zero logits → uniform softmax → cat sum = 5/1000 = 0.005 < 0.20.
    const { validateCat } = await loadIsCat();
    await expect(validateCat(await makeImage(32, 32))).resolves.toBe(false);
  });

  it('returns true when the cat-class sum is above the threshold', async () => {
    // logits[281] = 10, rest 0 → softmax ≈ e^10 / (e^10 + 999) ≈ 0.956 ≥ 0.20.
    h.logits[281] = 10;
    const { validateCat } = await loadIsCat();
    await expect(validateCat(await makeImage(32, 32))).resolves.toBe(true);
  });

  it('feeds the session a float32 tensor of shape [1, 3, 224, 224]', async () => {
    const { validateCat } = await loadIsCat();
    await validateCat(await makeImage(32, 32));
    expect(h.tensors.at(-1)).toEqual({ type: 'float32', dims: [1, 3, 224, 224] });
  });
});

describe('concurrency cap', () => {
  it('never runs more than 2 inferences at once', async () => {
    let release!: () => void;
    h.gate = new Promise<void>((res) => {
      release = res;
    });

    const { validateCat } = await loadIsCat();
    const buf = await makeImage(32, 32);
    const tasks = Array.from({ length: 5 }, () => validateCat(buf));

    // Two inferences reach the (blocked) session; three queue at the semaphore.
    await vi.waitFor(() => expect(h.runCalls).toBe(2));
    await new Promise((res) => setTimeout(res, 25));
    expect(h.runCalls).toBe(2);

    release();
    await Promise.all(tasks);
    expect(h.runCalls).toBe(5);
    expect(h.maxInFlight).toBeLessThanOrEqual(2);
  });
});

describe('missing model', () => {
  it('imports without throwing and rejects only when called', async () => {
    h.modelExists = false;
    const mod = await loadIsCat();
    expect(mod.validateCat).toBeTypeOf('function');
    await expect(mod.validateCat(await makeImage(32, 32))).rejects.toThrow(/ONNX model not found/);
  });
});
