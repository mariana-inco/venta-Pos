CREATE TABLE IF NOT EXISTS expense_evidence(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),session_id TEXT NOT NULL REFERENCES cash_sessions(id),created_at TEXT NOT NULL,storage_key TEXT NOT NULL UNIQUE,thumbnail_key TEXT NOT NULL UNIQUE,bytes INTEGER NOT NULL,content_hash TEXT NOT NULL,request_key TEXT NOT NULL,mime TEXT NOT NULL,UNIQUE(actor_id,request_key));
CREATE TABLE IF NOT EXISTS expense_evidence_links(expense_id TEXT PRIMARY KEY REFERENCES cash_expenses(id),evidence_id TEXT NOT NULL UNIQUE REFERENCES expense_evidence(id));
CREATE INDEX IF NOT EXISTS cash_expenses_date ON cash_expenses(created_at,id);
CREATE INDEX IF NOT EXISTS cash_expenses_bogota_day ON cash_expenses(date(created_at,'-5 hours'),created_at,id);
