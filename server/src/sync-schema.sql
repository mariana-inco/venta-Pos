CREATE TABLE IF NOT EXISTS sync_devices (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL,
 last_sequence INTEGER NOT NULL DEFAULT 0, last_seen_at TEXT
);
CREATE TABLE IF NOT EXISTS device_access (
 device_id TEXT NOT NULL REFERENCES sync_devices(id), user_id TEXT NOT NULL REFERENCES users(id),
 token_hash TEXT NOT NULL UNIQUE, revoked INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(device_id,user_id)
);
CREATE TABLE IF NOT EXISTS catalog_versions (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS device_catalogs (
 device_id TEXT NOT NULL REFERENCES sync_devices(id), version TEXT NOT NULL REFERENCES catalog_versions(id),
 PRIMARY KEY(device_id,version)
);
CREATE TABLE IF NOT EXISTS sync_events (
 device_id TEXT NOT NULL REFERENCES sync_devices(id), event_id TEXT NOT NULL,
 sequence INTEGER NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id), request_hash TEXT NOT NULL,
 payload TEXT NOT NULL, result TEXT NOT NULL, received_at TEXT NOT NULL,
 PRIMARY KEY(device_id,event_id), UNIQUE(device_id,sequence)
);
CREATE TABLE IF NOT EXISTS offline_sales (
 sale_id TEXT PRIMARY KEY REFERENCES sales(id), device_id TEXT NOT NULL REFERENCES sync_devices(id),
 sequence INTEGER NOT NULL, catalog_version TEXT NOT NULL REFERENCES catalog_versions(id),
 ticket_number TEXT NOT NULL UNIQUE, UNIQUE(device_id,sequence)
);
CREATE TABLE IF NOT EXISTS stock_debts (
 product_id TEXT PRIMARY KEY REFERENCES products(id), quantity_milli INTEGER NOT NULL CHECK(quantity_milli>=0)
);
CREATE TABLE IF NOT EXISTS sync_issues (
 id TEXT PRIMARY KEY, device_id TEXT NOT NULL, sale_id TEXT REFERENCES sales(id),
 detail TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sales_session_idx ON sales(session_id);
CREATE INDEX IF NOT EXISTS sale_items_sale_idx ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS payments_sale_idx ON payments(sale_id);
