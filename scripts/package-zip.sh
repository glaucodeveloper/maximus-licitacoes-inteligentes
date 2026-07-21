#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
VERSION="$(node -p "require('./package.json').version")"
OUT="maximus-licitacoes-inteligentes-pwa-v${VERSION}.zip"
rm -f "$OUT"
if command -v zip >/dev/null 2>&1; then
  zip -r "$OUT" . -x './node_modules/*' './dist/*' './.git/*' './public/wasm/*' './public/data/licitacoes.zip' './public/data/licitacoes-source.json' "./$OUT"
else
  python - "$OUT" <<'PY'
import os,sys,zipfile
out=sys.argv[1]
exclude={'node_modules','dist','.git','wasm'}
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
  for root,dirs,files in os.walk('.'):
    dirs[:]=[d for d in dirs if d not in exclude]
    for f in files:
      path=os.path.join(root,f)
      if path==f'./{out}': continue
      if path in {'./public/data/licitacoes.zip','./public/data/licitacoes-source.json'}: continue
      z.write(path,path[2:] if path.startswith('./') else path)
PY
fi
echo "$ROOT/$OUT"
