import {
  disposeTransformersRuntime,
  generateTransformersText,
  prepareTransformersModel,
} from './transformers-runtime.js';

let ready = false;
let maxNewTokens = 256;

const SPECIAL_TOKEN_PATTERN = /<(?:pad|bos|eos|start_of_turn|end_of_turn)>/i;
const TOKEN_PATTERN = /<[^>]+>|[\p{L}\p{N}_-]+|[^\s]/gu;
const SYSTEM_PROMPT = [
  'Você é a inteligência local da Maximus Empreendimentos para análise de licitações de engenharia.',
  'Responda em português brasileiro.',
  'Use somente os dados presentes no pedido.',
  'Diferencie fatos, riscos e recomendações.',
  'Quando for solicitado JSON, responda apenas com JSON válido, sem cercas de Markdown.',
].join(' ');

export class UnsafeModelOutputError extends Error {
  constructor(message = 'A inteligência local produziu uma saída inválida.') {
    super(message);
    this.name = 'UnsafeModelOutputError';
    this.code = 'UNSAFE_MODEL_OUTPUT';
  }
}

function hasRepetitionLoop(value) {
  const tokens = String(value ?? '').toLowerCase().match(TOKEN_PATTERN) ?? [];
  if (tokens.length < 36) return false;
  const tail = tokens.slice(-36);
  if (new Set(tail).size <= 2) return true;

  for (const width of [1, 2, 3, 4]) {
    const pattern = tail.slice(-width).join('\u0000');
    let repeats = 0;
    for (let offset = tail.length - width; offset >= 0; offset -= width) {
      if (tail.slice(offset, offset + width).join('\u0000') !== pattern) break;
      repeats += 1;
    }
    if (repeats >= 8) return true;
  }

  return false;
}

function validateOutput(value, maxChars = 48_000) {
  const text = String(value ?? '').trim();
  if (!text) throw new UnsafeModelOutputError('A análise não produziu uma resposta válida.');
  if (SPECIAL_TOKEN_PATTERN.test(text)) {
    throw new UnsafeModelOutputError('A análise foi interrompida.');
  }
  if (text.length > maxChars || hasRepetitionLoop(text)) {
    throw new UnsafeModelOutputError('A geração entrou em repetição ou ultrapassou o limite seguro.');
  }
  return text;
}

async function generate(prompt, limit = maxNewTokens) {
  const result = await generateTransformersText([
    {
      role: 'user',
      content: `${SYSTEM_PROMPT}\n\nTAREFA:\n${String(prompt ?? '')}`,
    },
  ], {maxNewTokens: limit});

  return validateOutput(result?.text);
}

export async function loadLocalAI({maxNumTokens = 256} = {}) {
  maxNewTokens = Math.max(64, Math.min(256, Number(maxNumTokens) || 256));
  await prepareTransformersModel();

  const check = await generate('Responda somente com a palavra MAXIMUS_OK.', 32);
  if (!/MAXIMUS[\s_-]*OK/i.test(check)) {
    throw new UnsafeModelOutputError('Não foi possível iniciar a análise.');
  }

  ready = true;
  return true;
}

export async function askLocalAI(prompt) {
  if (!ready) throw new Error('A inteligência local ainda não foi ativada.');
  return generate(prompt, maxNewTokens);
}

export async function disposeLocalAI() {
  ready = false;
  await disposeTransformersRuntime();
}
