import {env, pipeline} from '@huggingface/transformers';

const MODEL_ID = 'onnx-community/gemma-3-1b-it-ONNX';
const MODEL_DTYPE = 'q4';
const MODEL_DEVICE = 'wasm';
const CACHE_KEY = 'maximus-licitacoes-gemma3-cache';

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.useWasmCache = true;
env.cacheKey = CACHE_KEY;
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
  ? Math.max(1, Math.min(4, self.navigator?.hardwareConcurrency || 1))
  : 1;

let generatorPromise = null;
let generator = null;

function post(requestId, type, payload = null) {
  self.postMessage({requestId, type, payload});
}

function extractAssistantText(output) {
  const generated = output?.[0]?.generated_text;

  if (Array.isArray(generated)) {
    for (let index = generated.length - 1; index >= 0; index -= 1) {
      const message = generated[index];
      if (message?.role === 'assistant' && typeof message.content === 'string') {
        return message.content.trim();
      }
      if (message?.role === 'model' && typeof message.content === 'string') {
        return message.content.trim();
      }
    }
  }

  if (typeof generated === 'string') return generated.trim();
  throw new Error('A análise não produziu uma resposta reconhecível.');
}

async function ensureGenerator(requestId) {
  if (!generatorPromise) {
    generatorPromise = pipeline(
      'text-generation',
      MODEL_ID,
      {
        dtype: MODEL_DTYPE,
        device: MODEL_DEVICE,
        progress_callback: progress => post(requestId, 'progress', progress),
      },
    ).then(value => {
      generator = value;
      return value;
    }).catch(error => {
      generatorPromise = null;
      generator = null;
      throw error;
    });
  }

  return generatorPromise;
}

self.addEventListener('message', async event => {
  const {requestId, type, payload} = event.data ?? {};

  try {
    if (type === 'load') {
      await ensureGenerator(requestId);
      post(requestId, 'result', {ready: true});
      return;
    }

    if (type === 'generate') {
      const pipe = await ensureGenerator(requestId);
      const output = await pipe(payload.messages, {
        max_new_tokens: payload.maxNewTokens,
        do_sample: false,
        repetition_penalty: 1.08,
        return_full_text: true,
      });

      post(requestId, 'result', {text: extractAssistantText(output)});
      return;
    }

    if (type === 'dispose') {
      if (generator?.dispose) await generator.dispose();
      generator = null;
      generatorPromise = null;
      post(requestId, 'result', {disposed: true});
      return;
    }

    throw new Error(`Operação desconhecida do worker: ${type}`);
  } catch (error) {
    post(requestId, 'error', {
      name: error?.name || 'Error',
      message: error?.message || String(error),
      stack: error?.stack || '',
    });
  }
});
