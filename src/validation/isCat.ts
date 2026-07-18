import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { InferenceSession, Tensor } from 'onnxruntime-node';
import { Semaphore } from '../lib/semaphore';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../');

const MODEL_PATHS = [
  resolve(PROJECT_ROOT, 'models/mobilenetv2-cat.onnx'),
  resolve(PROJECT_ROOT, 'dist/models/mobilenetv2-cat.onnx'),
];

let ort: typeof import('onnxruntime-node') | null = null;
let sessionPromise: Promise<InferenceSession> | null = null;

async function createSession(): Promise<InferenceSession> {
  let modelPath: string | null = null;
  for (const candidate of MODEL_PATHS) {
    if (existsSync(candidate)) {
      modelPath = candidate;
      break;
    }
  }
  if (!modelPath) {
    throw new Error(`ONNX model not found at any of: ${MODEL_PATHS.join(', ')}`);
  }

  if (!ort) {
    try {
      ort = await import('onnxruntime-node');
    } catch {
      throw new Error('onnxruntime-node is not available');
    }
  }

  return ort.InferenceSession.create(modelPath);
}

async function ensureSession(): Promise<InferenceSession> {
  sessionPromise ??= createSession().catch((err) => {
    sessionPromise = null;
    throw err;
  });
  return sessionPromise;
}

async function preprocess(buf: Buffer): Promise<Float32Array> {
  const std = [0.229, 0.224, 0.225];
  const mean = [0.485, 0.456, 0.406];
  const { data, info } = await sharp(buf)
    .resize(224, 224, { fit: 'cover' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const planeSize = width * height;
  const nchw = new Float32Array(planeSize * channels);

  for (let c = 0; c < channels; c++) {
    for (let i = 0; i < planeSize; i++) {
      const pixel = data[i * channels + c] / 255.0;
      nchw[c * planeSize + i] = (pixel - mean[c]) / std[c];
    }
  }

  return nchw;
}

function softmax(logits: Float32Array): number[] {
  const max = Math.max(...logits);
  const exps = Array.from(logits, (x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/**
 * Cat class indices in ImageNet-1k (0-based):
 *   281 - tabby, tabby cat
 *   282 - tiger cat
 *   283 - Persian cat
 *   284 - Siamese cat, Siamese
 *   285 - Egyptian cat
 */
const CAT_INDICES = [281, 282, 283, 284, 285];

export const CAT_THRESHOLD = 0.2;

const semaphore = new Semaphore(2);

export async function validateCat(buf: Buffer): Promise<boolean> {
  return semaphore.run(async () => {
    const sess = await ensureSession();
    const tensorData = await preprocess(buf);

    const inputName = sess.inputNames[0];
    const tensor = new ort!.Tensor('float32', tensorData, [1, 3, 224, 224]);
    const feeds: Record<string, Tensor> = { [inputName]: tensor };

    const results = await sess.run(feeds);
    const output = results[sess.outputNames[0]].data as Float32Array;

    const probs = softmax(output);

    let catScore = 0;
    for (const idx of CAT_INDICES) {
      catScore += probs[idx];
    }

    return catScore >= CAT_THRESHOLD;
  });
}
