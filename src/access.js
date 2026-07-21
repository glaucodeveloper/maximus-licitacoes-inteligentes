const SESSION_KEY = 'maximus.licitacoes.github.token.session';
const PERSISTENT_KEY = 'maximus.licitacoes.github.token.persistent';

function normalizedAllowedLogins(config) {
  return (config?.access?.allowedLogins || [])
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean);
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
    if (response.status === 401) throw new Error('A chave de acesso é inválida ou expirou.');
    if (response.status === 403) throw new Error('A chave não possui autorização suficiente.');
    throw new Error(`Não foi possível validar o acesso: HTTP ${response.status}.`);
  }

  return response.json();
}

export async function validateAccessToken(config, token) {
  const normalized = String(token || '').trim();
  if (normalized.length < 20) throw new Error('Informe uma chave de acesso válida.');

  const identity = await githubRequest('/user', normalized);
  const allowed = normalizedAllowedLogins(config);
  const login = String(identity?.login || '').toLowerCase();

  if (allowed.length && !allowed.includes(login)) {
    throw new Error('Esta conta não está autorizada para acessar a plataforma.');
  }

  const repository = String(config?.access?.repository || '').trim();
  if (repository) await githubRequest(`/repos/${repository}`, normalized);

  return {
    login: identity.login,
    name: identity.name || identity.login,
  };
}
