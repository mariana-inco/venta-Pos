-- Append-only corrections: original closure snapshots remain untouched.
CREATE TABLE IF NOT EXISTS route_reopenings (
 id TEXT PRIMARY KEY, closure_id TEXT NOT NULL UNIQUE REFERENCES daily_closures(id),
 actor_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 request_key TEXT NOT NULL UNIQUE, snapshot TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cash_expenses (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES cash_sessions(id),
 actor_id TEXT NOT NULL REFERENCES users(id), route_id TEXT REFERENCES routes(id),
 description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 240),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), created_at TEXT NOT NULL,
 request_key TEXT NOT NULL, request_hash TEXT NOT NULL, UNIQUE(actor_id,request_key)
);
CREATE INDEX IF NOT EXISTS cash_expenses_session ON cash_expenses(session_id);
CREATE INDEX IF NOT EXISTS daily_closures_route_day ON daily_closures(route_id,day);
