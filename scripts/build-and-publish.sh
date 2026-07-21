#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OWNER="${GITHUB_OWNER:-$(gh api user --jq .login 2>/dev/null || true)}"
REPO="${GITHUB_REPO:-maximus-licitacoes-inteligentes}"
REMOTE="git@github.com:${OWNER}/${REPO}.git"

for command in node npm git gh python3; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Erro: comando obrigatório não encontrado: $command" >&2
    exit 1
  }
done

[[ -n "$OWNER" ]] || {
  echo 'Defina GITHUB_OWNER ou execute: gh auth login' >&2
  exit 1
}

gh auth status >/dev/null

cd "$ROOT"

echo 'Instalando dependências...'
NODE_OPTIONS=--use-system-ca npm install --registry=https://registry.npmjs.org

echo 'Validando aplicação...'
npm run validate
node --check src/main.js
node --check src/ai.js
node --check src/catalog.js
node --check src/transformers-worker.js
node --check src/transformers-runtime.js
node --check scripts/scrape-licitacoes.mjs

echo 'Compilando aplicação local...'
# O scraping ocorre no GitHub Actions. O build local não depende do TLS do portal.
NODE_OPTIONS=--use-system-ca npm run build:app

if ! gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  echo "Criando $OWNER/$REPO..."
  gh repo create "$OWNER/$REPO" \
    --public \
    --description 'Gestão e análise de licitações da Maximus Empreendimentos'
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo 'Preparando checkout limpo...'
if git clone "$REMOTE" "$WORK_DIR/repo" 2>/dev/null; then
  :
else
  mkdir -p "$WORK_DIR/repo"
  git -C "$WORK_DIR/repo" init
  git -C "$WORK_DIR/repo" branch -M main
  git -C "$WORK_DIR/repo" remote add origin "$REMOTE"
fi

TARGET="$WORK_DIR/repo"
find "$TARGET" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +

(
  cd "$ROOT"
  tar \
    --exclude='./.git' \
    --exclude='./node_modules' \
    --exclude='./dist' \
    --exclude='./*.zip' \
    --exclude='./public/data/licitacoes.zip' \
    --exclude='./public/data/licitacoes-source.json' \
    -cf - .
) | (
  cd "$TARGET"
  tar -xf -
)

cd "$TARGET"
git add -A

if git diff --cached --quiet; then
  git commit --allow-empty -m 'Atualizar Maximus Licitações Inteligentes'
else
  git commit -m 'Publicar Maximus Licitações Inteligentes com análise local'
fi

git push -u origin main

gh api --method POST "repos/$OWNER/$REPO/pages" \
  -f build_type=workflow >/dev/null 2>&1 || \
gh api --method PUT "repos/$OWNER/$REPO/pages" \
  -f build_type=workflow >/dev/null 2>&1 || true

echo
echo "Publicação enviada: https://github.com/$OWNER/$REPO/actions"
echo "Página: https://$OWNER.github.io/$REPO/"
