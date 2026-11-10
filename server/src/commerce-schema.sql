-- Additive migration: legacy products, sales, payments and documents stay intact.
CREATE TABLE IF NOT EXISTS routes(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS seller_routes(user_id TEXT PRIMARY KEY REFERENCES users(id),route_id TEXT NOT NULL REFERENCES routes(id));
CREATE TABLE IF NOT EXISTS customer_routes(customer_id TEXT NOT NULL REFERENCES customers(id),route_id TEXT NOT NULL REFERENCES routes(id),identification TEXT NOT NULL DEFAULT '',PRIMARY KEY(customer_id,route_id));
CREATE TABLE IF NOT EXISTS product_codes(code TEXT PRIMARY KEY COLLATE NOCASE,product_id TEXT NOT NULL REFERENCES products(id),kind TEXT NOT NULL CHECK(kind IN ('internal','barcode')));
CREATE INDEX IF NOT EXISTS product_codes_product ON product_codes(product_id);
CREATE TABLE IF NOT EXISTS inventory_groups(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,unit TEXT NOT NULL CHECK(unit IN ('unit','kg')));
CREATE TABLE IF NOT EXISTS product_groups(product_id TEXT PRIMARY KEY REFERENCES products(id),group_id TEXT NOT NULL REFERENCES inventory_groups(id));
CREATE TABLE IF NOT EXISTS route_stock(route_id TEXT NOT NULL REFERENCES routes(id),group_id TEXT NOT NULL REFERENCES inventory_groups(id),initial_milli INTEGER NOT NULL DEFAULT 0,available_milli INTEGER NOT NULL DEFAULT 0 CHECK(available_milli>=0),PRIMARY KEY(route_id,group_id));
CREATE TABLE IF NOT EXISTS stock_movements(id TEXT PRIMARY KEY,route_id TEXT NOT NULL REFERENCES routes(id),group_id TEXT NOT NULL REFERENCES inventory_groups(id),product_id TEXT REFERENCES products(id),sale_id TEXT REFERENCES sales(id),quantity_milli INTEGER NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('assign','adjust','sale','void')),actor_id TEXT NOT NULL REFERENCES users(id),note TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sale_terms(sale_id TEXT PRIMARY KEY REFERENCES sales(id),route_id TEXT REFERENCES routes(id),credit INTEGER NOT NULL CHECK(credit IN (0,1)),initial_paid_cents INTEGER NOT NULL CHECK(initial_paid_cents>=0));
CREATE TABLE IF NOT EXISTS sale_voids(sale_id TEXT PRIMARY KEY REFERENCES sales(id),actor_id TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id),seller_id TEXT NOT NULL REFERENCES users(id),route_id TEXT NOT NULL REFERENCES routes(id),session_id TEXT NOT NULL REFERENCES cash_sessions(id),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),method TEXT NOT NULL CHECK(method IN ('cash','electronic')),note TEXT NOT NULL,request_key TEXT NOT NULL,request_hash TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(seller_id,request_key));
CREATE TABLE IF NOT EXISTS collection_allocations(collection_id TEXT NOT NULL REFERENCES collections(id),sale_id TEXT NOT NULL REFERENCES sales(id),amount_cents INTEGER NOT NULL CHECK(amount_cents>0),PRIMARY KEY(collection_id,sale_id));
CREATE TABLE IF NOT EXISTS collection_reversals(collection_id TEXT PRIMARY KEY REFERENCES collections(id),actor_id TEXT NOT NULL REFERENCES users(id),reason TEXT NOT NULL,created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sale_stock_effects(sale_id TEXT NOT NULL REFERENCES sales(id),product_id TEXT NOT NULL REFERENCES products(id),quantity_milli INTEGER NOT NULL,PRIMARY KEY(sale_id,product_id));
