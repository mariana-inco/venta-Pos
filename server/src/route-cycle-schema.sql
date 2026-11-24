CREATE TABLE IF NOT EXISTS route_openings(id TEXT PRIMARY KEY,route_id TEXT NOT NULL REFERENCES routes(id),actor_id TEXT REFERENCES users(id),created_at TEXT NOT NULL,request_key TEXT UNIQUE,baseline TEXT NOT NULL,transition INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS route_cycle_closures(id TEXT PRIMARY KEY,opening_id TEXT NOT NULL UNIQUE REFERENCES route_openings(id),actor_id TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,snapshot TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS route_operation_links(kind TEXT NOT NULL,event_id TEXT NOT NULL,opening_id TEXT NOT NULL REFERENCES route_openings(id),PRIMARY KEY(kind,event_id));
CREATE TABLE IF NOT EXISTS inventory_group_status(group_id TEXT PRIMARY KEY REFERENCES inventory_groups(id),active INTEGER NOT NULL CHECK(active IN(0,1)));
CREATE TABLE IF NOT EXISTS route_cycle_migration(id INTEGER PRIMARY KEY CHECK(id=1),created_at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS link_cycle_movement AFTER INSERT ON stock_movements BEGIN
 INSERT INTO route_operation_links SELECT 'movement',NEW.id,o.id FROM route_openings o WHERE o.route_id=NEW.route_id AND NOT EXISTS(SELECT 1 FROM route_cycle_closures c WHERE c.opening_id=o.id) ORDER BY o.rowid DESC LIMIT 1;
END;
CREATE TRIGGER IF NOT EXISTS link_cycle_delivery AFTER INSERT ON delivery_batches BEGIN
 INSERT INTO route_operation_links SELECT 'delivery',NEW.id,o.id FROM route_openings o WHERE o.route_id=NEW.route_id AND NOT EXISTS(SELECT 1 FROM route_cycle_closures c WHERE c.opening_id=o.id) ORDER BY o.rowid DESC LIMIT 1;
END;
CREATE TRIGGER IF NOT EXISTS link_cycle_sale AFTER INSERT ON sale_terms WHEN NEW.route_id IS NOT NULL BEGIN
 INSERT INTO route_operation_links SELECT 'sale',NEW.sale_id,o.id FROM route_openings o WHERE o.route_id=NEW.route_id AND NOT EXISTS(SELECT 1 FROM route_cycle_closures c WHERE c.opening_id=o.id) ORDER BY o.rowid DESC LIMIT 1;
END;
CREATE TRIGGER IF NOT EXISTS link_cycle_draft AFTER INSERT ON sale_drafts BEGIN
 INSERT INTO route_operation_links SELECT 'draft',NEW.id,o.id FROM route_openings o WHERE o.route_id=NEW.route_id AND NOT EXISTS(SELECT 1 FROM route_cycle_closures c WHERE c.opening_id=o.id) ORDER BY o.rowid DESC LIMIT 1;
END;
