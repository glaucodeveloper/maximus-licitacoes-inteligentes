export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS empresa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  razao_social TEXT, cnpj TEXT, porte TEXT, municipio TEXT, estado TEXT,
  cidade_base TEXT, objeto_social TEXT, cnae_principal TEXT,
  responsavel_cadastro TEXT
);
CREATE TABLE IF NOT EXISTS empresa_cnae (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa_id INTEGER, codigo TEXT,
  descricao TEXT, origem_documento_id INTEGER, pagina INTEGER, confirmado INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS profissional (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa_id INTEGER, nome TEXT, cpf TEXT,
  conselho TEXT, numero_registro TEXT, vinculo TEXT, documento_origem_id INTEGER
);
CREATE TABLE IF NOT EXISTS documento (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa_id INTEGER, tipo TEXT, nome TEXT,
  arquivo TEXT, hash TEXT, status TEXT, data_emissao TEXT, data_validade TEXT,
  texto_extraido TEXT, confirmado_em TEXT, confirmado_por TEXT,
  inferencia_status TEXT, inferencia_json TEXT, inferencia_em TEXT, criado_em TEXT
);
CREATE TABLE IF NOT EXISTS cat (
  id INTEGER PRIMARY KEY AUTOINCREMENT, documento_id INTEGER, numero TEXT,
  conselho TEXT, estado TEXT, data_emissao TEXT, profissional_id INTEGER,
  art_numero TEXT, contratante TEXT, contratante_documento TEXT, objeto TEXT,
  data_inicio TEXT, data_conclusao TEXT
);
CREATE TABLE IF NOT EXISTS cat_servico (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cat_id INTEGER, categoria_normalizada TEXT,
  descricao_original TEXT, quantidade TEXT, unidade TEXT, pagina INTEGER,
  trecho TEXT, confianca TEXT, confirmado INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS licitacao (
  id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT, numero_formatado TEXT,
  modalidade TEXT, orgao TEXT, unidade TEXT, objeto TEXT, localidade TEXT,
  valor_estimado TEXT, data_sessao TEXT, situacao TEXT, fonte TEXT, importado_em TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_licitacao_numero_orgao ON licitacao(numero, orgao);
CREATE TABLE IF NOT EXISTS edital_documento (
  id INTEGER PRIMARY KEY AUTOINCREMENT, licitacao_id INTEGER, url TEXT, arquivo TEXT,
  hash TEXT, versao TEXT, data_download TEXT, caminho_local TEXT, status_download TEXT,
  texto_extraido TEXT, status_analise TEXT, data_analise TEXT,
  inferencia_status TEXT, inferencia_json TEXT, inferencia_em TEXT
);
CREATE TABLE IF NOT EXISTS edital_fase (
  id INTEGER PRIMARY KEY AUTOINCREMENT, edital_documento_id INTEGER, nome TEXT, ordem INTEGER
);
CREATE TABLE IF NOT EXISTS edital_topico (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fase_id INTEGER, titulo TEXT, ordem INTEGER
);
CREATE TABLE IF NOT EXISTS requisito (
  id INTEGER PRIMARY KEY AUTOINCREMENT, topico_id INTEGER, categoria TEXT,
  prioridade_analise TEXT, filtro_legal_localidade TEXT, titulo TEXT, descricao TEXT,
  valor_exigido TEXT, unidade TEXT, obrigatorio INTEGER DEFAULT 0, pagina INTEGER,
  secao TEXT, trecho TEXT, item_edital TEXT, prazo TEXT, analise TEXT,
  representa TEXT, pesquisa_recomendada TEXT, referencias_relacionadas TEXT,
  acao_licitante TEXT, evidencia_esperada TEXT, risco TEXT, parte_analise TEXT
);
CREATE TABLE IF NOT EXISTS correlacao_documental (
  id INTEGER PRIMARY KEY AUTOINCREMENT, requisito_id INTEGER, documento_id INTEGER,
  pagina_documento INTEGER, trecho_documento TEXT, valor_localizado TEXT,
  unidade TEXT, situacao TEXT, observacao TEXT, confirmado INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS prompt_operational (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chave TEXT UNIQUE, nome TEXT, descricao TEXT,
  instrucao TEXT, modelo TEXT, temperatura TEXT, atualizado_em TEXT
);
CREATE TABLE IF NOT EXISTS fonte_sync (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fonte TEXT, url TEXT, versao_remota TEXT,
  hash_local TEXT, sincronizado_em TEXT, status TEXT
);
`;

export const SEED_SQL = `
INSERT INTO empresa (razao_social, porte, municipio, estado, cidade_base, objeto_social, responsavel_cadastro)
SELECT 'Maximus Empreendimentos', 'LTDA', '', 'BA', '', 'Engenharia e empreendimentos', ''
WHERE NOT EXISTS (SELECT 1 FROM empresa);

INSERT OR IGNORE INTO prompt_operational (chave,nome,descricao,instrucao,modelo,temperatura,atualizado_em) VALUES
('edital_resumo','Leitura executiva','Resume objeto, prazo, valor e participação.','Analise o edital com foco executivo. Não invente dados ausentes.','Inteligência Maximus','0.1',datetime('now')),
('edital_requisitos','Extração de requisitos','Identifica exigências jurídicas, fiscais, técnicas e econômico-financeiras.','Produza JSON com uma lista requirements. Cada item deve conter categoria, titulo, descricao, obrigatorio, pagina, risco e acao_licitante.','Inteligência Maximus','0.1',datetime('now')),
('correlacao','Correlação documental','Compara requisitos com documentos da empresa.','Compare o requisito com o texto do documento e informe situação, evidência, lacuna e risco.','Inteligência Maximus','0.1',datetime('now'));
`;
