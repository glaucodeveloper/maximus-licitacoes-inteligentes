# Maximus Licitações Inteligentes

Aplicativo instalável para acompanhamento de editais, gestão documental e análise local.

## Inicialização

1. Valida a chave de acesso autorizada.
2. Verifica a versão publicada dos editais.
3. Baixa e incorpora o catálogo apenas quando a versão mudou.
4. Verifica se a inteligência local está completa no cache.
5. Baixa o modelo somente quando os arquivos necessários não estão completos.

A tela apresenta progresso percentual separado para editais e inteligência.

## Acesso

Os logins autorizados ficam em `public/app-config.json`:

```json
{
  "access": {
    "required": true,
    "allowedLogins": ["glaucodeveloper"],
    "repository": "",
    "rememberByDefault": true
  }
}
```

A chave é validada na API do GitHub. Ela não é enviada ao modelo local.

## Inteligência local

- Modelo: `onnx-community/gemma-3-1b-it-ONNX`
- Quantização: `int8`
- Execução: CPU/WebAssembly
- Cache persistente do navegador

## Desenvolvimento

```bash
npm install
npm run validate
npm run build:app
npm run dev
```

O scraping do portal é realizado no build agendado do GitHub Actions. O navegador consome somente o manifesto e o ZIP publicados na mesma origem.

## Compatibilidade CPU

A variante `int8` é usada porque a variante `q4` depende do operador
`GatherBlockQuantized`, indisponível no backend WebAssembly observado em
alguns navegadores. A atualização remove o cache q4 antigo e prepara a variante
int8 uma única vez.
