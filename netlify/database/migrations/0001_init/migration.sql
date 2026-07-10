-- Esquema inicial do sistema de Controle de Licenças e Autorizações - Swot

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin_master','usuario')),
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cnpj TEXT,
  status TEXT NOT NULL DEFAULT 'ativo',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS client_required_licenses (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  observacao TEXT
);

CREATE TABLE IF NOT EXISTS client_contacts (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  nome TEXT,
  email TEXT NOT NULL,
  receber_alertas BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS licenses (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  classe TEXT,
  unidade TEXT,
  descricao TEXT NOT NULL,
  numero TEXT,
  orgao_expeditor TEXT,
  responsavel TEXT,
  emissao DATE,
  validade DATE,
  renovacao_lead_days INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'valido',
  info_adicional TEXT,
  documento_blob_key TEXT,
  documento_nome TEXT,
  auto_enviar_aviso BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_licenses_client ON licenses(client_id);
CREATE INDEX IF NOT EXISTS idx_licenses_validade ON licenses(validade);

CREATE TABLE IF NOT EXISTS email_log (
  id SERIAL PRIMARY KEY,
  license_id INTEGER REFERENCES licenses(id) ON DELETE SET NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL,
  destinatarios TEXT NOT NULL,
  assunto TEXT,
  corpo TEXT,
  anexo_nome TEXT,
  enviado_por INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'enviado',
  erro_msg TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS legislation_updates (
  id SERIAL PRIMARY KEY,
  titulo TEXT NOT NULL,
  descricao TEXT,
  link TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_por INTEGER REFERENCES users(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS legislation_reads (
  id SERIAL PRIMARY KEY,
  legislation_id INTEGER NOT NULL REFERENCES legislation_updates(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(legislation_id, user_id)
);
