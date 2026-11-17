-- Additive: preserve original immutable payment and sale rows.
CREATE TABLE IF NOT EXISTS sale_drafts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),agent_id TEXT NOT NULL REFERENCES sales_agents(id),customer_id TEXT NOT NULL REFERENCES customers(id),route_id TEXT NOT NULL REFERENCES routes(id),customer_type TEXT NOT NULL,prices TEXT NOT NULL,request_hash TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payment_references(id TEXT PRIMARY KEY,platform_id TEXT NOT NULL REFERENCES platforms(id),reference TEXT NOT NULL,normalized_reference TEXT NOT NULL,payment_id TEXT UNIQUE REFERENCES payments(id),collection_id TEXT UNIQUE REFERENCES collections(id),created_at TEXT NOT NULL,UNIQUE(platform_id,normalized_reference),CHECK((payment_id IS NOT NULL AND collection_id IS NULL) OR (payment_id IS NULL AND collection_id IS NOT NULL)));

INSERT OR IGNORE INTO platforms VALUES ('bancolombia','Bancolombia',1),('bold','Bold',1);
