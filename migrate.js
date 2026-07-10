'use strict';
// =====================================================================
// Migrations do banco de dados - Swot Controle de Licencas
// Executa automaticamente ao iniciar o servidor.
// Cada migration roda apenas uma vez (controlado pela tabela _migrations).
// =====================================================================
const postgres = require('postgres');

const MIGRATIONS = [
  {
    id: '0001_init',
    sql: `
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
        documento_data BYTEA,
        documento_mime TEXT,
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
    `,
  },
  {
    id: '0002_seed',
    sql: `
      -- Usuarios (senhas definidas na entrega)
      INSERT INTO users (name, email, password_hash, role, must_change_password)
      VALUES ('Fernanda Mateus', 'fernanda@swot.net.br',
        '8e335eaec6ebfa6177f67a013bdfb4ec:429f93e172af477daf557937bfc822429b54802c30b3b9d97923620f90e81c55d0224e3277bbbeade8132ffc356396953d64c5fea38a2140528729ee425da520',
        'admin_master', TRUE)
      ON CONFLICT (email) DO NOTHING;

      INSERT INTO users (name, email, password_hash, role, must_change_password)
      VALUES ('Thaynara Oliveira', 'thaynara@swot.net.br',
        'ce3b087a48140ac945fee7fc63024b6b:25f9e30da08d9e780fdefa826b324ba69d8aa11c5cec19c76ac99cd273be2527e6fa0cedcfec1f8d9c4c643ff612f29b678ad507480fa63ce0f455a4d30cfe96',
        'usuario', TRUE)
      ON CONFLICT (email) DO NOTHING;

      -- Clientes
      INSERT INTO clients (name, cnpj) VALUES ('BOTUVERÁ', NULL);
      INSERT INTO clients (name, cnpj) VALUES ('CARVALHO COMERCIO E TRANSPORTES LTDA', '22.686.175/0001-37');
      INSERT INTO clients (name, cnpj) VALUES ('CENTRAL LOGÍSTICA', NULL);
      INSERT INTO clients (name, cnpj) VALUES ('GO LOG TRANSPORTES LTDA', NULL);
      INSERT INTO clients (name, cnpj) VALUES ('HDR TRANSPORTES RODOVIARIOS LTDA', '47.282.795/0001-31');
      INSERT INTO clients (name, cnpj) VALUES ('NOVA FROTA TRANSPORTES E LOGÍSTICA LTDA', '21.984.393/0002-76');
      INSERT INTO clients (name, cnpj) VALUES ('P & R7 TRANSPORTES LTDA', '17.542.385/0003-83');
      INSERT INTO clients (name, cnpj) VALUES ('PIANETTO TRANSPORTES E LOGÍSTICA LTDA', '43.976.512/0001-09');
      INSERT INTO clients (name, cnpj) VALUES ('RDM TRANSPORTES E LOGÍSTICA LTDA', NULL);
      INSERT INTO clients (name, cnpj) VALUES ('RODORRISO TRANSPORTES JZ LTDA', NULL);
      INSERT INTO clients (name, cnpj) VALUES ('SYMBOLUS LOG', NULL);
      INSERT INTO clients (name, cnpj) VALUES ('TRANSJULIA TRANSPORTES RODOVIARIOS LTDA', NULL);
      INSERT INTO clients (name, cnpj) VALUES ('TRANSPORTES E LOGÍSTICA CONCEIÇÃO LTDA', '20.718.088/0001-99');
      INSERT INTO clients (name, cnpj) VALUES ('ZP LOG TRANSPORTES LTDA (Rodozape)', NULL);
      INSERT INTO clients (name, cnpj) VALUES ('BELLUNO', NULL);
      INSERT INTO clients (name, cnpj) VALUES ('JCL JANDOTTI', NULL);

      -- Licencas obrigatorias por cliente
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'SASSMAQ' FROM clients WHERE name = 'BOTUVERÁ';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'SASSMAQ' FROM clients WHERE name = 'CARVALHO COMERCIO E TRANSPORTES LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'GMP+FSA' FROM clients WHERE name = 'CARVALHO COMERCIO E TRANSPORTES LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'SASSMAQ' FROM clients WHERE name = 'CENTRAL LOGÍSTICA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'GMP+FSA' FROM clients WHERE name = 'CENTRAL LOGÍSTICA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'ANVISA' FROM clients WHERE name = 'GO LOG TRANSPORTES LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'IBAMA' FROM clients WHERE name = 'HDR TRANSPORTES RODOVIARIOS LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'POLÍCIA FEDERAL' FROM clients WHERE name = 'HDR TRANSPORTES RODOVIARIOS LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'EXÉRCITO' FROM clients WHERE name = 'HDR TRANSPORTES RODOVIARIOS LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'LICENÇA AMBIENTAL' FROM clients WHERE name = 'HDR TRANSPORTES RODOVIARIOS LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'IBAMA' FROM clients WHERE name = 'NOVA FROTA TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'POLÍCIA FEDERAL' FROM clients WHERE name = 'NOVA FROTA TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'EXÉRCITO' FROM clients WHERE name = 'NOVA FROTA TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'SASSMAQ' FROM clients WHERE name = 'NOVA FROTA TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'GMP+FSA' FROM clients WHERE name = 'NOVA FROTA TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'IBAMA' FROM clients WHERE name = 'P & R7 TRANSPORTES LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'POLÍCIA FEDERAL' FROM clients WHERE name = 'P & R7 TRANSPORTES LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'EXÉRCITO' FROM clients WHERE name = 'P & R7 TRANSPORTES LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'SASSMAQ' FROM clients WHERE name = 'P & R7 TRANSPORTES LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'IBAMA' FROM clients WHERE name = 'PIANETTO TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'POLÍCIA FEDERAL' FROM clients WHERE name = 'PIANETTO TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'EXÉRCITO' FROM clients WHERE name = 'PIANETTO TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'ANVISA' FROM clients WHERE name = 'PIANETTO TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'SASSMAQ' FROM clients WHERE name = 'PIANETTO TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'GMP+FSA' FROM clients WHERE name = 'PIANETTO TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'ANVISA' FROM clients WHERE name = 'RDM TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'ISO 9001' FROM clients WHERE name = 'RDM TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'SASSMAQ' FROM clients WHERE name = 'RDM TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'GMP+FSA' FROM clients WHERE name = 'SYMBOLUS LOG';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'IBAMA' FROM clients WHERE name = 'TRANSJULIA TRANSPORTES RODOVIARIOS LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'IBAMA' FROM clients WHERE name = 'TRANSPORTES E LOGÍSTICA CONCEIÇÃO LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'POLÍCIA FEDERAL' FROM clients WHERE name = 'TRANSPORTES E LOGÍSTICA CONCEIÇÃO LTDA';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'ISO 9001' FROM clients WHERE name = 'ZP LOG TRANSPORTES LTDA (Rodozape)';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'ANVISA' FROM clients WHERE name = 'BELLUNO';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'ISO 9001' FROM clients WHERE name = 'BELLUNO';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'SASSMAQ' FROM clients WHERE name = 'BELLUNO';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'GMP+FSA' FROM clients WHERE name = 'BELLUNO';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'POLÍCIA FEDERAL' FROM clients WHERE name = 'JCL JANDOTTI';
      INSERT INTO client_required_licenses (client_id, tipo) SELECT id, 'EXÉRCITO' FROM clients WHERE name = 'JCL JANDOTTI';

      -- Licencas (dados reais da planilha)
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Licença Transporte', 'Matriz', 'CERTIFICADO DE LICENÇA DE FUNCIONAMENTO - CLF + CRC', '2024-00656919', 'Polícia Federal', 'Fernanda', '2025-06-24', '2026-06-26', 65, 'valido', 'Solicitado a Renovação Imprimir' FROM clients WHERE name = 'HDR TRANSPORTES RODOVIARIOS LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Requisitos Legais', 'Matriz', 'CERTIFICADO DE REGULARIDADE - CR', '8578363', 'Ibama', 'Fernanda', '2026-05-31', '2026-08-31', 86, 'valido', NULL FROM clients WHERE name = 'HDR TRANSPORTES RODOVIARIOS LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Requisitos Legais', 'Matriz', 'AUTORIZAÇÃO AMBIENTAL - AATIPP', '8578363', 'Ibama', 'Fernanda', '2026-05-31', '2026-08-31', 86, 'valido', NULL FROM clients WHERE name = 'HDR TRANSPORTES RODOVIARIOS LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Licença Transporte', 'Matriz', 'CERTIFICADO DE REGISTRO - CR', '1071243', 'Exercito', 'Fernanda', '2025-01-30', '2027-01-07', 60, 'valido', 'Renovar 60 dias antes do vencimento' FROM clients WHERE name = 'HDR TRANSPORTES RODOVIARIOS LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Licença Transporte', 'Matriz', 'CERTIFICADO DE LICENÇA DE FUNCIONAMENTO - CLF + CRC', '2024-00664091', 'Polícia Federal', 'Fernanda', '2025-10-15', '2026-11-06', 60, 'valido', 'Renovar 60 dias antes do vencimento' FROM clients WHERE name = 'NOVA FROTA TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Requisitos Legais', 'Matriz', 'CERTIFICADO DE REGULARIDADE - CR', '8723504', 'Ibama', 'Fernanda', '2026-04-07', '2026-07-07', 86, 'valido', NULL FROM clients WHERE name = 'NOVA FROTA TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Requisitos Legais', 'Matriz', 'AUTORIZAÇÃO AMBIENTAL - AATIPP', '8723504', 'Ibama', 'Fernanda', '2026-04-07', '2026-07-07', 86, 'valido', NULL FROM clients WHERE name = 'NOVA FROTA TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Requisitos Legais', 'Filial', 'CERTIFICADO DE REGULARIDADE - CR', '8723504', 'Ibama', 'Fernanda', '2026-04-07', '2026-07-07', 168, 'valido', NULL FROM clients WHERE name = 'NOVA FROTA TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Requisitos Legais', 'Filial', 'AUTORIZAÇÃO AMBIENTAL - AATIPP', '8723504', 'Ibama', 'Fernanda', '2026-04-07', '2026-07-07', 168, 'valido', NULL FROM clients WHERE name = 'NOVA FROTA TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Transporte', 'Matriz', 'CERTIFICADO DE REGISTRO', '1071568', 'Exercito', 'Fernanda', '2025-01-20', '2027-01-10', 131, 'valido', NULL FROM clients WHERE name = 'NOVA FROTA TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Certificação', 'Matriz', 'CERTIFICADO SASSMAQ', '167.009/25', 'ABNT', 'Fernanda', '2025-02-07', '2027-02-07', 402, 'valido', NULL FROM clients WHERE name = 'NOVA FROTA TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Requisitos Legais', 'Matriz', 'CERTIFICADO DE REGULARIDADE - CR', '8615208', 'Ibama', 'Fernanda', '2026-05-31', '2026-08-31', 2, 'valido', 'Tem alguem da empresa mexendo' FROM clients WHERE name = 'PIANETTO TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Requisitos Legais', 'Matriz', 'AUTORIZAÇÃO AMBIENTAL - AATIPP', '8615208', 'Ibama', 'Fernanda', '2026-05-31', '2026-08-31', 2, 'valido', 'Tem alguem da empresa mexendo' FROM clients WHERE name = 'PIANETTO TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Requisitos Legais', 'Matriz', 'CERTIFICADO DE LICENÇA DE FUNCIONAMENTO - CLF + CRC', '2024-00661145', 'Polícia Federal', 'Fernanda', '2025-10-15', '2026-09-19', 60, 'valido', 'Guia vencida, enviada novamente para pagamento / Guia paga / aguardando CR' FROM clients WHERE name = 'PIANETTO TRANSPORTES E LOGÍSTICA LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Licença Transporte', 'Filial', 'CERTIFICADO DE LICENÇA DE FUNCIONAMENTO - CLF + CRC', '2025-00667857', 'Polícia Federal', 'Fernanda', '2026-02-05', '2027-02-05', 60, 'valido', 'Renovar 60 dias antes do vencimento' FROM clients WHERE name = 'P & R7 TRANSPORTES LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Requisitos Legais', 'Filial - MG', 'CERTIFICADO DE REGULARIDADE - CR', '8339357', 'Ibama', 'Fernanda', '2026-04-06', '2026-07-06', 85, 'valido', NULL FROM clients WHERE name = 'P & R7 TRANSPORTES LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Requisitos Legais', 'Filial - MG', 'AUTORIZAÇÃO AMBIENTAL - AATIPP', '8339357', 'Ibama', 'Fernanda', '2026-04-06', '2026-07-06', 85, 'valido', NULL FROM clients WHERE name = 'P & R7 TRANSPORTES LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Licença Transporte', 'Matriz', 'CERTIFICADO DE LICENÇA DE FUNCIONAMENTO - CLF + CRC', '2024-00660259', 'Polícia Federal', 'Fernanda', '2025-09-04', '2026-09-04', 60, 'valido', 'Renovação solicitada GRU enviada por e-mail' FROM clients WHERE name = 'TRANSPORTES E LOGÍSTICA CONCEIÇÃO LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Requisitos Legais', 'Matriz', 'AUTORIZAÇÃO AMBIENTAL - AATIPP', '8294120', 'Ibama', 'Fernanda', '2026-04-06', '2026-07-06', 180, 'valido', NULL FROM clients WHERE name = 'TRANSPORTES E LOGÍSTICA CONCEIÇÃO LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Requisitos Legais', 'Matriz', 'CERTIFICADO DE REGULARIDADE - CR', '8294120', 'Ibama', 'Fernanda', '2026-04-06', '2026-07-06', 180, 'valido', NULL FROM clients WHERE name = 'TRANSPORTES E LOGÍSTICA CONCEIÇÃO LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Requisitos Legais', 'Matriz', 'AUTORIZAÇÃO AMBIENTAL - AATIPP', '6038470', 'Ibama', 'Fernanda', '2026-02-16', '2026-05-16', 60, 'valido', NULL FROM clients WHERE name = 'TRANSJULIA TRANSPORTES RODOVIARIOS LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Requisitos Legais', 'Matriz', 'CERTIFICADO DE REGULARIDADE - CR', '6038470', 'Ibama', 'Fernanda', '2026-06-19', '2026-05-16', 60, 'valido', NULL FROM clients WHERE name = 'TRANSJULIA TRANSPORTES RODOVIARIOS LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Requisitos Legais', 'Matriz', 'AUTORIZAÇÃO AMBIENTAL - AATIPP', '7698768', 'Ibama', 'Fernanda', '2026-06-08', '2026-09-08', 60, 'valido', NULL FROM clients WHERE name = 'CARVALHO COMERCIO E TRANSPORTES LTDA';
      INSERT INTO licenses (client_id, classe, unidade, descricao, numero, orgao_expeditor, responsavel, emissao, validade, renovacao_lead_days, status, info_adicional)
        SELECT id, 'Requisitos Legais', 'Matriz', 'CERTIFICADO DE REGULARIDADE - CR', '7698768', 'Ibama', 'Fernanda', '2026-06-08', '2026-09-08', 60, 'valido', NULL FROM clients WHERE name = 'CARVALHO COMERCIO E TRANSPORTES LTDA';
    `,
  },
];

async function runMigrations() {
  const sql = postgres(process.env.DATABASE_URL, {
    ssl: { rejectUnauthorized: false },
    max: 3,
  });

  try {
    // Cria tabela de controle de migrations
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    for (const migration of MIGRATIONS) {
      const existing = await sql`SELECT id FROM _migrations WHERE id = ${migration.id}`;
      if (existing.length > 0) {
        console.log(`Migration ja aplicada: ${migration.id}`);
        continue;
      }

      console.log(`Aplicando migration: ${migration.id}...`);
      await sql.unsafe(migration.sql);
      await sql`INSERT INTO _migrations (id) VALUES (${migration.id})`;
      console.log(`Migration aplicada: ${migration.id}`);
    }
  } finally {
    await sql.end();
  }
}

module.exports = { runMigrations };

// Permite executar diretamente: node migrate.js
if (require.main === module) {
  if (!process.env.DATABASE_URL) {
    console.error('Defina a variavel DATABASE_URL antes de executar.');
    process.exit(1);
  }
  runMigrations()
    .then(() => { console.log('Migrations concluidas!'); process.exit(0); })
    .catch((err) => { console.error('Erro:', err.message); process.exit(1); });
}
