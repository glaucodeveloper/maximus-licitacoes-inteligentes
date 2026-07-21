const SESSION_KEY = 'maximus.licitacoes.github.token.session';
const PERSISTENT_KEY = 'maximus.licitacoes.github.token.persistent';
const FINE_GRAINED_PREFIX = 'github_pat_';

function normalizedAllowedLogins(config) {
  return (config?.access?.allowedLogins || [])
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

function normalizedRepository(config) {
  const repository = String(config?.access?.repository || '').trim();
  if (!repository) return '';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('O repositório autorizado está configurado incorretamente.');
  }
  return repository;
}

export function loadAccessToken() {
  return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(PERSISTENT_KEY) || '';
}

export function saveAccessToken(token, remember = false) {
  clearAccessToken();
  const target = remember ? localStorage : sessionStorage;
  target.setItem(remember ? PERSISTENT_KEY : SESSION_KEY, token);
}

export function clearAccessToken() {
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(PERSISTENT_KEY);
}

async function githubRequest(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    cache: 'no-store',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('O fine-grained personal access token é inválido ou expirou.');
    }
    if (response.status === 403) {
      throw new Error('O fine-grained personal access token não possui a autorização necessária.');
    }
    if (response.status === 404) {
      throw new Error('O token não possui acesso ao repositório autorizado.');
    }
    throw new Error(`Não foi possível validar o acesso: HTTP ${response.status}.`);
  }

  return response.json();
}

export async function validateAccessToken(config, token) {
  const normalized = String(token || '').trim();

  if (!normalized.startsWith(FINE_GRAINED_PREFIX)) {
    throw new Error('Use um fine-grained personal access token iniciado por github_pat_.');
  }

  if (normalized.length < 30) {
    throw new Error('Informe um fine-grained personal access token válido.');
  }

  const identity = await githubRequest('/user', normalized);
  const allowed = normalizedAllowedLogins(config);
  const login = String(identity?.login || '').toLowerCase();

  if (!login) {
    throw new Error('Não foi possível identificar a conta associada ao token.');
  }

  if (allowed.length && !allowed.includes(login)) {
    throw new Error('Esta conta não está autorizada para acessar a plataforma.');
  }

  const repository = normalizedRepository(config);
  if (repository) {
    const repositoryInfo = await githubRequest(`/repos/${repository}`, normalized);
    if (String(repositoryInfo?.full_name || '').toLowerCase() !== repository.toLowerCase()) {
      throw new Error('O token não corresponde ao repositório autorizado.');
    }
  }

  return {
    login: identity.login,
    name: identity.name || identity.login,
    avatarUrl: identity.avatar_url || '',
    tokenType: 'fine-grained',
  };
}
