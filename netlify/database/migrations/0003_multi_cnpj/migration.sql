-- Permite cadastrar mais de um CNPJ por cliente, e vincular uma licenca a um CNPJ especifico.
CREATE TABLE IF NOT EXISTS client_cnpjs (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  cnpj TEXT NOT NULL,
  apelido TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_cnpjs_client ON client_cnpjs(client_id);

ALTER TABLE licenses ADD COLUMN IF NOT EXISTS cnpj_id INTEGER REFERENCES client_cnpjs(id) ON DELETE SET NULL;

-- Migra o CNPJ unico ja cadastrado em clients.cnpj para a nova tabela, como o primeiro CNPJ do cliente.
INSERT INTO client_cnpjs (client_id, cnpj)
  SELECT id, cnpj FROM clients WHERE cnpj IS NOT NULL AND TRIM(cnpj) <> '';
