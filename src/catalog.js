import {unzipSync, strFromU8} from 'fflate';
import {one, run, transaction} from './db.js';

const OFFICIAL_SOURCE = 'portal-dados-ba';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows.shift().map(value => value.trim().toLowerCase());
  return rows.map(values => Object.fromEntries(
    headers.map((header, index) => [header, values[index]?.trim() || '']),
  ));
}

function pick(record, aliases) {
  for (const key of aliases) {
    const exact = record[key];
    if (exact != null && String(exact).trim()) return String(exact).trim();

    const found = Object.keys(record).find(name => (
      name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase() === key
    ));

    if (found && String(record[found]).trim()) return String(record[found]).trim();
  }

  return '';
}

function normalize(record) {
  const numero = pick(record, ['numero', 'num_licitacao', 'numero_licitacao', 'número']);
  const orgao = pick(record, ['orgao', 'órgão', 'nome_orgao', 'unidade_gestora']);

  return {
    numero,
    numeroFormatado: pick(record, ['numero_formatado', 'num_formatado']) || numero.replace(/\D/g, ''),
    modalidade: pick(record, ['modalidade', 'nome_modalidade']),
    orgao,
    unidade: pick(record, ['unidade', 'unidade_gestora', 'nome_unidade']),
    objeto: pick(record, ['objeto', 'descricao_objeto', 'descrição']),
    localidade: pick(record, ['localidade', 'municipio', 'município', 'cidade']),
    valor: pick(record, ['valor_estimado', 'valor', 'valor_total']),
    dataSessao: pick(record, ['data_sessao', 'data_abertura', 'data']),
    situacao: pick(record, ['situacao', 'situação', 'status']) || 'importado',
  };
}

function insertRecords(records, source) {
  let inserted = 0;

  for (const raw of records) {
    const item = normalize(raw);
    if (!item.numero && !item.objeto) continue;

    run(`INSERT OR REPLACE INTO licitacao
      (id,numero,numero_formatado,modalidade,orgao,unidade,objeto,localidade,valor_estimado,data_sessao,situacao,fonte,importado_em)
      VALUES ((SELECT id FROM licitacao WHERE numero=? AND orgao=?),?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`, [
      item.numero,
      item.orgao,
      item.numero,
      item.numeroFormatado,
      item.modalidade,
      item.orgao,
      item.unidade,
      item.objeto,
      item.localidade,
      item.valor,
      item.dataSessao,
      item.situacao,
      source,
    ]);

    inserted += 1;
  }

  return inserted;
}

export function importRecords(records, source = 'arquivo local') {
  return transaction(() => insertRecords(records, source));
}

async function readCatalogRecords(file) {
  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (name.endsWith('.json')) {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return Array.isArray(parsed) ? parsed : parsed.records || parsed.data || [];
  }

  if (name.endsWith('.csv')) {
    return parseCsv(new TextDecoder('utf-8').decode(bytes));
  }

  if (name.endsWith('.zip')) {
    const files = unzipSync(bytes);
    const records = [];

    for (const [entry, content] of Object.entries(files)) {
      const lower = entry.toLowerCase();

      if (lower.endsWith('.csv')) {
        records.push(...parseCsv(strFromU8(content)));
      } else if (lower.endsWith('.json')) {
        const parsed = JSON.parse(strFromU8(content));
        records.push(...(Array.isArray(parsed) ? parsed : parsed.records || parsed.data || []));
      }
    }

    return records;
  }

  throw new Error('Formato de catálogo não reconhecido.');
}

export async function importCatalogFile(file, {
  source = file.name,
  replaceSource = false,
} = {}) {
  const records = await readCatalogRecords(file);

  return transaction(() => {
    if (replaceSource) run('DELETE FROM licitacao WHERE fonte=?', [source]);
    return insertRecords(records, source);
  });
}

const BUNDLED_MANIFEST_URL = './data/licitacoes-source.json';
const BUNDLED_ZIP_URL = './data/licitacoes.zip';

function notify(onProgress, detail) {
  onProgress({
    phase: 'catalog',
    label: 'Preparando editais',
    percent: 0,
    received: 0,
    total: 0,
    ...detail,
  });
}

async function readBundledManifest() {
  const response = await fetch(BUNDLED_MANIFEST_URL, {
    cache: 'no-store',
    headers: {accept: 'application/json'},
  });

  if (!response.ok) {
    throw new Error(`A atualização de editais ainda não está disponível: HTTP ${response.status}.`);
  }

  const manifest = await response.json();

  if (
    manifest?.complete !== true ||
    !manifest?.version ||
    !manifest?.sha256 ||
    !Number.isFinite(Number(manifest?.bytes))
  ) {
    throw new Error('A atualização de editais publicada está incompleta.');
  }

  return manifest;
}

async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
}

async function downloadCatalogBlob(expectedBytes, onProgress) {
  const response = await fetch(BUNDLED_ZIP_URL, {
    cache: 'no-store',
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Não foi possível carregar os editais: HTTP ${response.status}.`);
  }

  if (!response.body) {
    const blob = await response.blob();
    notify(onProgress, {
      label: 'Baixando editais',
      percent: 90,
      received: blob.size,
      total: expectedBytes,
    });
    return blob;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  let lastPercent = -1;

  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;

    const percent = Math.min(90, Math.floor((received / expectedBytes) * 90));
    if (percent !== lastPercent) {
      lastPercent = percent;
      notify(onProgress, {
        label: 'Baixando editais',
        percent,
        received,
        total: expectedBytes,
      });
    }
  }

  return new Blob(chunks, {type: 'application/zip'});
}

function localCatalogCount() {
  return Number(one('SELECT COUNT(*) AS total FROM licitacao')?.total || 0);
}

function syncRecord() {
  return one(
    'SELECT * FROM fonte_sync WHERE fonte=? ORDER BY id DESC LIMIT 1',
    [OFFICIAL_SOURCE],
  );
}

function saveSyncRecord({url, version, hash, status}) {
  const existing = syncRecord();

  if (existing) {
    run(`UPDATE fonte_sync
      SET url=?, versao_remota=?, hash_local=?, sincronizado_em=datetime('now'), status=?
      WHERE id=?`, [url, version, hash, status, existing.id]);
  } else {
    run(`INSERT INTO fonte_sync
      (fonte,url,versao_remota,hash_local,sincronizado_em,status)
      VALUES (?,?,?,?,datetime('now'),?)`, [OFFICIAL_SOURCE, url, version, hash, status]);
  }
}

export async function syncOfficialCatalog(onProgress = () => {}) {
  const existingCount = localCatalogCount();

  try {
    notify(onProgress, {label: 'Verificando editais', percent: 2});

    const manifest = await readBundledManifest();
    const previous = syncRecord();

    if (
      previous?.status === 'ok' &&
      previous?.versao_remota === manifest.version &&
      previous?.hash_local === manifest.sha256 &&
      existingCount > 0
    ) {
      notify(onProgress, {
        label: 'Editais atualizados',
        percent: 100,
        received: Number(manifest.bytes),
        total: Number(manifest.bytes),
      });
      return {changed: false, count: existingCount};
    }

    const expectedBytes = Number(manifest.bytes);
    const blob = await downloadCatalogBlob(expectedBytes, onProgress);

    if (blob.size !== expectedBytes) {
      throw new Error(`O arquivo de editais está incompleto: ${blob.size} de ${expectedBytes} bytes.`);
    }

    notify(onProgress, {
      label: 'Validando editais',
      percent: 94,
      received: blob.size,
      total: expectedBytes,
    });

    const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
      throw new Error('O arquivo publicado para os editais não é um ZIP válido.');
    }

    const hash = await sha256Hex(blob);
    if (hash !== manifest.sha256) {
      throw new Error('A verificação do arquivo de editais não corresponde à versão publicada.');
    }

    if (previous?.status === 'ok' && previous?.hash_local === hash && existingCount > 0) {
      saveSyncRecord({
        url: manifest.downloadUrl || BUNDLED_ZIP_URL,
        version: manifest.version,
        hash,
        status: 'ok',
      });
      notify(onProgress, {
        label: 'Editais atualizados',
        percent: 100,
        received: blob.size,
        total: expectedBytes,
      });
      return {changed: false, count: existingCount};
    }

    notify(onProgress, {
      label: 'Incorporando editais',
      percent: 97,
      received: blob.size,
      total: expectedBytes,
    });

    const file = new File([blob], 'licitacoes.zip', {type: 'application/zip'});
    const count = await importCatalogFile(file, {
      source: OFFICIAL_SOURCE,
      replaceSource: true,
    });

    saveSyncRecord({
      url: manifest.downloadUrl || BUNDLED_ZIP_URL,
      version: manifest.version,
      hash,
      status: 'ok',
    });

    notify(onProgress, {
      label: 'Editais prontos',
      percent: 100,
      received: blob.size,
      total: expectedBytes,
    });

    return {changed: true, count};
  } catch (error) {
    if (existingCount > 0) {
      notify(onProgress, {label: 'Editais disponíveis', percent: 100});
      return {changed: false, count: existingCount, offline: true};
    }

    throw error;
  }
}
