import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {access, mkdir, readFile, rename, stat, unlink, writeFile} from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(projectRoot, 'public', 'data');
const zipPath = path.join(dataDir, 'licitacoes.zip');
const tempZipPath = `${zipPath}.download`;
const manifestPath = path.join(dataDir, 'licitacoes-source.json');

const appConfig = JSON.parse(await readFile(path.join(projectRoot, 'public', 'app-config.json'), 'utf8'));
const sourcePage = process.env.LICITACOES_DATASET_PAGE || appConfig?.catalog?.datasetPageUrl;
if (!sourcePage) throw new Error('A página oficial dos editais não foi configurada.');

const userAgent = 'Maximus-Licitacoes-Inteligentes/1.0 (+https://github.com/glaucodeveloper)';
const allowedInsecureHosts = new Set(['dados.ba.gov.br', 'www.dados.ba.gov.br']);
const caCandidates = [
  process.env.CURL_CA_BUNDLE,
  '/etc/ssl/certs/ca-certificates.crt',
  '/etc/ca-certificates/extracted/tls-ca-bundle.pem',
  '/etc/pki/tls/certs/ca-bundle.crt',
].filter(Boolean);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function decodeHtml(value) {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripTags(value) {
  return decodeHtml(String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

async function existingCaFile() {
  for (const candidate of caCandidates) {
    try {
      await access(candidate, fsConstants.R_OK);
      return candidate;
    } catch {
      // Tenta o próximo bundle do sistema.
    }
  }
  return '';
}

function curlResponseFromHead(stdout) {
  const blocks = String(stdout).trim().split(/\r?\n\r?\n/);
  const block = blocks.at(-1) || '';
  const lines = block.split(/\r?\n/);
  const status = Number(lines[0]?.match(/\s(\d{3})\s/)?.[1] || 200);
  const responseHeaders = new Headers();

  for (const line of lines.slice(1)) {
    const separator = line.indexOf(':');
    if (separator > 0) {
      responseHeaders.set(
        line.slice(0, separator).trim(),
        line.slice(separator + 1).trim(),
      );
    }
  }

  return new Response(null, {status, headers: responseHeaders});
}

async function runCurl(url, options, {insecure = false} = {}) {
  const headers = options.headers || {};
  const args = [
    '--fail',
    '--location',
    '--silent',
    '--show-error',
    '--compressed',
    '--connect-timeout', '30',
    '--max-time', '900',
  ];

  if (options.method === 'HEAD') args.push('--head');

  const caFile = await existingCaFile();
  if (caFile && !insecure) args.push('--cacert', caFile);
  if (insecure) args.push('--insecure');

  for (const [name, value] of Object.entries(headers)) {
    args.push('--header', `${name}: ${value}`);
  }

  args.push(url);

  const {stdout} = await execFileAsync('curl', args, {
    encoding: options.method === 'HEAD' ? 'utf8' : 'buffer',
    maxBuffer: 1024 * 1024 * 1024,
  });

  if (options.method === 'HEAD') return curlResponseFromHead(stdout);
  return new Response(stdout, {status: 200});
}

async function fetchWithFallback(url, options = {}) {
  const headers = {
    'user-agent': userAgent,
    accept: '*/*',
    ...(options.headers || {}),
  };

  try {
    return await fetch(url, {
      redirect: 'follow',
      cache: 'no-store',
      ...options,
      headers,
    });
  } catch (fetchError) {
    const curlOptions = {...options, headers};

    try {
      return await runCurl(url, curlOptions);
    } catch (secureCurlError) {
      const host = new URL(url).hostname.toLowerCase();

      if (!allowedInsecureHosts.has(host)) {
        throw new Error(
          `Falha ao acessar ${url}: ${fetchError.message}; curl: ${secureCurlError.message}`,
        );
      }

      console.warn(
        `Aviso: a cadeia TLS de ${host} não foi validada pelo sistema. ` +
        'Usando fallback restrito a esse portal e validando o conteúdo baixado.',
      );

      try {
        return await runCurl(url, curlOptions, {insecure: true});
      } catch (insecureCurlError) {
        throw new Error(
          `Falha ao acessar ${url}: ${fetchError.message}; ` +
          `curl seguro: ${secureCurlError.message}; ` +
          `fallback restrito: ${insecureCurlError.message}`,
        );
      }
    }
  }
}

async function fetchText(url) {
  const response = await fetchWithFallback(url, {
    headers: {accept: 'text/html,application/xhtml+xml'},
  });
  if (!response.ok) throw new Error(`Página indisponível: HTTP ${response.status}.`);
  return response.text();
}

function anchorsFromHtml(html, baseUrl) {
  const anchors = [];
  const pattern = /<a\b([^>]*?)href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = pattern.exec(html))) {
    const rawHref = decodeHtml(match[2] || match[3] || match[4] || '').trim();
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) continue;

    let href;
    try {
      href = new URL(rawHref, baseUrl).href;
    } catch {
      continue;
    }

    anchors.push({
      href,
      rawHref,
      text: stripTags(match[6]),
      index: match.index,
      html: match[0],
    });
  }

  return anchors;
}

function scoreZipAnchor(anchor) {
  const value = `${anchor.text} ${anchor.href}`.toLowerCase();
  let score = 0;

  if (/licitac(?:ao|oes|ões|o|õ)/i.test(value)) score += 80;
  if (/\.zip(?:$|[?#])/i.test(anchor.href)) score += 100;
  if (/\/download\//i.test(anchor.href)) score += 70;
  if (/\bdownload\b|\bbaixar\b/i.test(anchor.text)) score += 25;
  if (/resource\//i.test(anchor.href)) score += 10;
  if (/\.png|\.pdf|\.csv/i.test(anchor.href)) score -= 100;

  return score;
}

function resourceBlock(html, index) {
  const starts = [
    html.lastIndexOf('<li', index),
    html.lastIndexOf('<article', index),
    html.lastIndexOf('<section', index),
    html.lastIndexOf('<div', index),
  ].filter(value => value >= 0);

  const start = starts.length ? Math.max(...starts) : Math.max(0, index - 1000);
  const endCandidates = ['</li>', '</article>', '</section>', '</div>']
    .map(tag => html.indexOf(tag, index))
    .filter(value => value >= 0);
  const end = endCandidates.length
    ? Math.min(...endCandidates) + 12
    : Math.min(html.length, index + 2000);

  return html.slice(start, end).replace(/\s+/g, ' ').trim();
}

async function discoverDownloadFromPage(pageUrl) {
  const html = await fetchText(pageUrl);
  const anchors = anchorsFromHtml(html, pageUrl)
    .map(anchor => ({...anchor, score: scoreZipAnchor(anchor)}))
    .sort((a, b) => b.score - a.score);

  let selected = anchors.find(anchor =>
    anchor.score >= 100 &&
    (/\.zip(?:$|[?#])/i.test(anchor.href) || /\/download\//i.test(anchor.href)),
  );

  if (!selected) {
    const resourcePage = anchors.find(anchor =>
      anchor.score >= 70 && /\/resource\//i.test(anchor.href),
    );

    if (resourcePage) {
      const resourceHtml = await fetchText(resourcePage.href);
      const resourceAnchors = anchorsFromHtml(resourceHtml, resourcePage.href)
        .map(anchor => ({...anchor, score: scoreZipAnchor(anchor)}))
        .sort((a, b) => b.score - a.score);

      selected = resourceAnchors.find(anchor =>
        /\.zip(?:$|[?#])/i.test(anchor.href) || /\/download\//i.test(anchor.href),
      );

      if (selected) {
        return {
          downloadUrl: selected.href,
          pageFingerprint: sha256(
            resourceBlock(html, resourcePage.index) +
            resourceBlock(resourceHtml, selected.index),
          ),
        };
      }
    }
  }

  if (!selected) {
    const rawMatch = html.match(
      /https?:\/\/[^"'<>\s]+(?:\.zip(?:[?#][^"'<>\s]*)?|\/download\/[^"'<>\s]+)/i,
    );

    if (rawMatch) {
      return {
        downloadUrl: decodeHtml(rawMatch[0]),
        pageFingerprint: sha256(rawMatch[0]),
      };
    }

    throw new Error('A página não apresentou um link para o catálogo de licitações.');
  }

  return {
    downloadUrl: selected.href,
    pageFingerprint: sha256(resourceBlock(html, selected.index)),
  };
}

async function remoteMetadata(downloadUrl, pageFingerprint) {
  let etag = '';
  let lastModified = '';
  let contentLength = 0;

  try {
    const response = await fetchWithFallback(downloadUrl, {method: 'HEAD'});
    if (response.ok) {
      etag = response.headers.get('etag') || '';
      lastModified = response.headers.get('last-modified') || '';
      contentLength = Number(response.headers.get('content-length')) || 0;
    }
  } catch {
    // O fingerprint da página continua disponível para comparação.
  }

  const sourceVersion = sha256(JSON.stringify({
    downloadUrl,
    pageFingerprint,
    etag,
    lastModified,
    contentLength,
  }));

  return {etag, lastModified, contentLength, sourceVersion};
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function existingZipIsComplete(manifest) {
  if (!manifest?.complete || !manifest?.bytes || !manifest?.sha256) return false;

  try {
    const info = await stat(zipPath);
    return info.isFile() && info.size === Number(manifest.bytes);
  } catch {
    return false;
  }
}

async function downloadZip(url) {
  const response = await fetchWithFallback(url, {
    headers: {accept: 'application/zip,application/octet-stream,*/*'},
  });

  if (!response.ok) {
    throw new Error(`Não foi possível baixar o catálogo: HTTP ${response.status}.`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (
    buffer.length < 100 ||
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b
  ) {
    throw new Error('O conteúdo recebido não é um arquivo ZIP válido.');
  }

  await writeFile(tempZipPath, buffer);
  return buffer;
}

await mkdir(dataDir, {recursive: true});

console.log(`Consultando página oficial: ${sourcePage}`);
const discovered = await discoverDownloadFromPage(sourcePage);
const metadata = await remoteMetadata(
  discovered.downloadUrl,
  discovered.pageFingerprint,
);
const previous = await readJson(manifestPath);
const localComplete = await existingZipIsComplete(previous);

if (localComplete && previous.sourceVersion === metadata.sourceVersion) {
  console.log('Catálogo já corresponde à versão publicada. Download ignorado.');
  process.exit(0);
}

console.log(`Link encontrado no HTML: ${discovered.downloadUrl}`);
console.log('Baixando versão publicada para validação...');

try {
  const buffer = await downloadZip(discovered.downloadUrl);
  const contentHash = sha256(buffer);

  if (localComplete && previous.sha256 === contentHash) {
    await unlink(tempZipPath).catch(() => {});
    console.log('O conteúdo é idêntico ao catálogo local.');
  } else {
    await rename(tempZipPath, zipPath);
    console.log(`Novo catálogo armazenado: ${(buffer.length / 1024 / 1024).toFixed(1)} MiB.`);
  }

  const finalInfo = await stat(zipPath);
  const manifest = {
    schemaVersion: 1,
    sourcePage,
    downloadUrl: discovered.downloadUrl,
    sourceVersion: metadata.sourceVersion,
    version: contentHash,
    sha256: contentHash,
    bytes: finalInfo.size,
    etag: metadata.etag,
    lastModified: metadata.lastModified,
    pageFingerprint: discovered.pageFingerprint,
    complete: true,
    checkedAt: new Date().toISOString(),
  };

  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  console.log('Catálogo preparado para publicação.');
} catch (error) {
  await unlink(tempZipPath).catch(() => {});

  if (localComplete) {
    console.warn(`Aviso: ${error.message}`);
    console.warn('Mantendo a última versão completa do catálogo.');
    process.exit(0);
  }

  throw error;
}
