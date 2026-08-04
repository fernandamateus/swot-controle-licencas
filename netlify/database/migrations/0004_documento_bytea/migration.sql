-- Migra o armazenamento do documento anexado de Netlify Blobs (documento_blob_key)
-- para armazenamento direto no Postgres (BYTEA), alinhando com o backend Railway/Express.
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS documento_data BYTEA;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS documento_mime TEXT;
