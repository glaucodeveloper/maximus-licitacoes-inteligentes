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

function datasetSlug(datasetPageUrl) {
  const url = new URL(datasetPageUrl, location.href);
  const match = url.pathname.match(/\/dataset\/([^/?#]+)/i);
  return match?.[1] || 'licitacoes';
}

function chooseZipResource(resources) {
  const zipResources = resources.filter(resource => (
    String(resource.format || '').toUpperCase() === 'ZIP' ||
    /\.zip(?:$|[?#])/i.test(String(resource.url || ''))
  ));

  return zipResources.find(resource => (
    /licitac/i.test(String(resource.name || '')) ||
    /licitac/i.test(String(resource.url || ''))
  )) || zipResources[0] || null;
}

async function discoverThroughCkanApi(datasetPageUrl) {
  const page = new URL(datasetPageUrl, location.href);
  const api = new URL('/api/3/action/package_show', page.origin);
  api.searchParams.set('id', datasetSlug(datasetPageUrl));

  const response = await fetch(api, {
    cache: 'no-store',
    headers: {accept: 'application/json'},
  });

  if (!response.ok) throw new Error(`Catálogo remoto indisponível: HTTP ${response.status}.`);

  const payload = await response.json();
  if (!payload?.success || !payload?.result) {
    throw new Error('O portal não retornou os metadados do catálogo.');
  }

  const resource = chooseZipResource(payload.result.resources || []);
  if (!resource?.url) throw new Error('O portal não informou o arquivo ZIP de licitações.');

  const url = new URL(resource.url, page.origin).href;
  const version = [
    resource.id,
    resource.last_modified,
    resource.hash,
    resource.size,
    payload.result.metadata_modified,
    url,
  ].filter(Boolean).join('|');

  return {
    url,
    version,
    lastModified: resource.last_modified || payload.result.metadata_modified || '',
    bytes: Number(resource.size) || 0,
  };
}

async function discoverByScrapingPage(datasetPageUrl) {
  const page = new URL(datasetPageUrl, location.href);
  const response = await fetch(page, {cache: 'no-store'});
  if (!response.ok) throw new Error(`Página de dados indisponível: HTTP ${response.status}.`);

  const html = await response.text();
  const document = new DOMParser().parseFromString(html, 'text/html');
  const links = [...document.querySelectorAll('a[href]')];

  const anchor = links.find(link => {
    const href = link.getAttribute('href') || '';
    const text = link.textContent || '';
    return (/licitac/i.test(`${href} ${text}`) && /(?:\.zip|\/download\/)/i.test(href));
  }) || links.find(link => /\.zip(?:$|[?#])/i.test(link.getAttribute('href') || ''));

  if (!anchor) throw new Error('A página de dados não apresentou um link ZIP.');

  const url = new URL(anchor.getAttribute('href'), page).href;
  return {url, version: url, lastModified: '', bytes: 0};
}

async function discoverOfficialZip(datasetPageUrl) {
  try {
    return await discoverThroughCkanApi(datasetPageUrl);
  } catch (apiError) {
    try {
      return await discoverByScrapingPage(datasetPageUrl);
    } catch (pageError) {
      throw new Error(`${apiError.message} ${pageError.message}`.trim());
    }
  }
}

async function enrichWithHead(resource) {
  try {
    const response = await fetch(resource.url, {
      method: 'HEAD',
      cache: 'no-store',
      redirect: 'follow',
    });

    if (!response.ok) return resource;

    const etag = response.headers.get('etag') || '';
    const lastModified = response.headers.get('last-modified') || resource.lastModified || '';
    const bytes = Number(response.headers.get('content-length')) || resource.bytes || 0;
    const version = [resource.version, etag, lastModified, bytes].filter(Boolean).join('|');

    return {...resource, version, etag, lastModified, bytes};
  } catch {
    return resource;
  }
}

async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');
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

export async function syncOfficialCatalog(datasetPageUrl, onProgress = () => {}) {
  const existingCount = localCatalogCount();

  try {
    onProgress('Verificando atualizações dos editais…');

    const discovered = await discoverOfficialZip(datasetPageUrl);
    const remote = await enrichWithHead(discovered);
    const previous = syncRecord();

    if (
      previous?.status === 'ok' &&
      previous?.versao_remota &&
      previous.versao_remota === remote.version &&
      existingCount > 0
    ) {
      return {changed: false, count: existingCount};
    }

    onProgress('Atualizando editais…');

    const response = await fetch(remote.url, {
      cache: 'no-store',
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`Não foi possível baixar os editais: HTTP ${response.status}.`);
    }

    const blob = await response.blob();
    if (blob.size < 100) throw new Error('O arquivo de editais recebido está vazio.');

    const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
      throw new Error('O arquivo recebido não é um ZIP válido.');
    }

    const hash = await sha256Hex(blob);

    if (previous?.status === 'ok' && previous?.hash_local === hash && existingCount > 0) {
      saveSyncRecord({url: remote.url, version: remote.version, hash, status: 'ok'});
      return {changed: false, count: existingCount};
    }

    onProgress('Incorporando novos editais…');

    const file = new File([blob], 'licitacoes.zip', {type: 'application/zip'});
    const count = await importCatalogFile(file, {
      source: OFFICIAL_SOURCE,
      replaceSource: true,
    });

    saveSyncRecord({url: remote.url, version: remote.version, hash, status: 'ok'});

    return {changed: true, count};
  } catch (error) {
    if (existingCount > 0) {
      return {changed: false, count: existingCount, offline: true};
    }

    throw error;
  }
}
