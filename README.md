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

O aplicativo aceita exclusivamente **fine-grained personal access tokens**, identificados pelo prefixo `github_pat_`. Tokens clássicos `ghp_` são recusados.

Configuração em `public/app-config.json`:

```json
{
  "access": {
    "required": true,
    "tokenType": "fine-grained",
    "allowedLogins": ["glaucodeveloper"],
    "repository": "glaucodeveloper/maximus-licitacoes-inteligentes",
    "rememberByDefault": true
  }
}
```

Criação recomendada no GitHub:

- Resource owner: `glaucodeveloper`;
- Repository access: `Only select repositories`;
- repositório: `maximus-licitacoes-inteligentes`;
- Repository permissions: `Contents: Read-only`;
- `Metadata: Read-only` é concedida automaticamente.

A validação confirma o prefixo do token, a conta autenticada e o acesso ao repositório configurado. A chave não é enviada ao modelo local.

## Inteligência local

- Modelo: `onnx-community/gemma-3-1b-it-ONNX`
- Quantização: `uint8`
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

A variante `uint8` é usada em CPU/WebAssembly. O carregamento fica fixado em uma revisão do modelo que contém `model_uint8.onnx` como arquivo único, evitando a tentativa de buscar o arquivo inexistente `model_int8.onnx_data`. A atualização remove os caches q4/int8 anteriores e prepara a variante uint8 uma única vez.
