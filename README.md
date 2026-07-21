# Maximus Licitações Inteligentes

Aplicação para acompanhar editais, organizar documentos e analisar aderência às oportunidades.

## Funcionamento

Ao iniciar, a aplicação consulta a página oficial de licitações do Portal de Dados Abertos da Bahia, identifica o arquivo ZIP atual e compara sua versão com a última incorporação local.

- mesma versão: utiliza os editais já incorporados;
- nova versão: baixa e incorpora o catálogo atualizado;
- portal temporariamente indisponível: mantém os editais já disponíveis no dispositivo.

A análise local utiliza Gemma 3 1B e é preparada uma única vez por dispositivo.

## Publicar

```bash
chmod +x scripts/*.sh
GITHUB_OWNER=seu-usuario \
GITHUB_REPO=maximus-licitacoes-inteligentes \
./scripts/build-and-publish.sh
```
