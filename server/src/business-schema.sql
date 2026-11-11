-- Extension tables leave legacy row shapes, snapshots and foreign keys intact.
CREATE TABLE IF NOT EXISTS customer_profiles(customer_id TEXT PRIMARY KEY REFERENCES customers(id),customer_type TEXT NOT NULL CHECK(customer_type IN ('normal','wholesale')));
INSERT OR IGNORE INTO customer_profiles SELECT id,'normal' FROM customers;
CREATE TABLE IF NOT EXISTS product_pricing(product_id TEXT PRIMARY KEY REFERENCES products(id),wholesale_price_cents INTEGER CHECK(wholesale_price_cents>0));
CREATE TABLE IF NOT EXISTS sales_agents(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN(0,1)),UNIQUE(user_id,name));
CREATE TABLE IF NOT EXISTS sale_agents(sale_id TEXT PRIMARY KEY REFERENCES sales(id),agent_id TEXT NOT NULL REFERENCES sales_agents(id));
CREATE TABLE IF NOT EXISTS delivery_batches(id TEXT PRIMARY KEY,route_id TEXT NOT NULL REFERENCES routes(id),actor_id TEXT NOT NULL REFERENCES users(id),request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,created_at TEXT NOT NULL,note TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS delivery_items(batch_id TEXT NOT NULL REFERENCES delivery_batches(id),product_id TEXT NOT NULL REFERENCES products(id),quantity_milli INTEGER NOT NULL CHECK(quantity_milli>0),PRIMARY KEY(batch_id,product_id));
CREATE TABLE IF NOT EXISTS daily_closures(id TEXT PRIMARY KEY,route_id TEXT NOT NULL REFERENCES routes(id),day TEXT NOT NULL,actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,snapshot TEXT NOT NULL,UNIQUE(route_id,day));
CREATE TABLE IF NOT EXISTS business_policy(id INTEGER PRIMARY KEY CHECK(id=1),enabled_at TEXT NOT NULL);
INSERT OR IGNORE INTO business_policy VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
