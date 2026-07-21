export const TRANSFORMERS_MODEL = Object.freeze({
  id: 'onnx-community/gemma-3-1b-it-ONNX',
  dtype: 'q4',
  cacheKey: 'maximus-licitacoes-gemma3-cache',
  markerKey: 'maximus.licitacoes.gemma3.q4.complete',
  approximateBytes: 885_000_000,
});

let client = null;

class WorkerClient {
  constructor() {
    this.worker = new Worker(new URL('./transformers-worker.js', import.meta.url), {
      type: 'module',
    });
    this.sequence = 0;
    this.pending = new Map();

    this.worker.addEventListener('message', event => {
      const {requestId, type, payload} = event.data ?? {};
      const request = this.pending.get(requestId);
      if (!request) return;

      if (type === 'progress') {
        request.onProgress?.(payload);
        return;
      }

      this.pending.delete(requestId);

      if (type === 'error') {
        const error = new Error(payload?.message || 'Não foi possível iniciar a análise.');
        error.name = payload?.name || 'Error';
        error.stack = payload?.stack || error.stack;
        request.reject(error);
        return;
      }

      request.resolve(payload);
    });

    this.worker.addEventListener('error', event => {
      const error = new Error(event.message || 'A análise foi interrompida.');
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    });
  }

  request(type, payload = null, onProgress = null) {
    const requestId = `gemma3-${Date.now()}-${++this.sequence}`;

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {resolve, reject, onProgress});
      this.worker.postMessage({requestId, type, payload});
    });
  }

  load(onProgress) {
    return this.request('load', null, onProgress);
  }

  generate(messages, maxNewTokens) {
    return this.request('generate', {messages, maxNewTokens});
  }

  async dispose() {
    try {
      await this.request('dispose');
    } finally {
      this.worker.terminate();
    }
  }
}

function getClient() {
  if (!client) client = new WorkerClient();
  return client;
}

function normalizeProgress(info) {
  if (!info || info.status !== 'progress') return null;

  const received = Number(info.loaded) || 0;
  const total = Number(info.total) || TRANSFORMERS_MODEL.approximateBytes;
  const percent = Number(info.progress);
  const ratio = Number.isFinite(percent) ? percent / 100 : received / total;

  return {
    received,
    total,
    ratio: Math.max(0, Math.min(1, ratio || 0)),
    file: info.file || '',
  };
}

function writeCompleteMarker() {
  localStorage.setItem(TRANSFORMERS_MODEL.markerKey, JSON.stringify({
    complete: true,
    modelId: TRANSFORMERS_MODEL.id,
    dtype: TRANSFORMERS_MODEL.dtype,
    completedAt: new Date().toISOString(),
  }));
}

export function hasCompleteMarker() {
  try {
    const value = JSON.parse(localStorage.getItem(TRANSFORMERS_MODEL.markerKey) || 'null');
    return value?.complete === true &&
      value?.modelId === TRANSFORMERS_MODEL.id &&
      value?.dtype === TRANSFORMERS_MODEL.dtype;
  } catch {
    return false;
  }
}

export async function prepareTransformersModel({onProgress = () => {}} = {}) {
  await navigator.storage?.persist?.();
  await getClient().load(info => {
    const progress = normalizeProgress(info);
    if (progress) onProgress(progress);
  });
  writeCompleteMarker();
  return true;
}

export async function generateTransformersText(messages, {maxNewTokens = 256} = {}) {
  await prepareTransformersModel();
  return getClient().generate(messages, Math.max(64, Math.min(256, maxNewTokens)));
}

export async function disposeTransformersRuntime() {
  if (!client) return;
  await client.dispose().catch(() => {});
  client = null;
}

export async function deleteTransformersModel() {
  await disposeTransformersRuntime();
  localStorage.removeItem(TRANSFORMERS_MODEL.markerKey);
  if ('caches' in globalThis) await caches.delete(TRANSFORMERS_MODEL.cacheKey);
}
