import {
  deleteTransformersModel,
  hasCompleteMarker,
  prepareTransformersModel,
  TRANSFORMERS_MODEL,
} from './transformers-runtime.js';

export const MODEL = Object.freeze({
  id: 'gemma-3-1b-it-q4-cpu',
  displayName: 'Inteligência Maximus',
  approximateBytes: TRANSFORMERS_MODEL.approximateBytes,
});

export async function hasModel() {
  return hasCompleteMarker();
}

export async function downloadModel({onProgress = () => {}, signal} = {}) {
  if (signal?.aborted) throw new DOMException('Preparação cancelada.', 'AbortError');

  await prepareTransformersModel({
    onProgress: progress => {
      if (signal?.aborted) return;
      onProgress(progress);
    },
  });

  if (signal?.aborted) throw new DOMException('Preparação cancelada.', 'AbortError');
  return true;
}

export async function deleteModel() {
  await deleteTransformersModel();
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** exponent).toFixed(exponent >= 3 ? 2 : 1)} ${units[exponent]}`;
}
