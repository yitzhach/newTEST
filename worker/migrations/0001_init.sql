-- ===========================================================================
-- Show Ledger — members' intel network
-- D1 schema, migration 0001
--
-- Design notes that matter more than the columns:
--
-- 1. There is no `private` visibility in this database. A private report is
--    the artist's own business and never leaves their device, so the API
--    refuses to store one. The server cannot leak what it was never given.
--
-- 2. Invite codes are stored as SHA-256 hashes. A dump of this table does not
--    let anyone join the network.
--
-- 3. Author identity is a column, not a property of the payload. Anonymising
--    a report at read time is then a matter of not selecting a column, rather
--    than remembering to strip a field out of some JSON.
--
-- 4. Everything is soft-deleted. A network where a member can permanently
--    erase a season's reported results is a network whose medians move for
--    reasons nobody can audit.
-- ===========================================================================

CREATE TABLE members (
  id             TEXT PRIMARY KEY,
  display_name   TEXT NOT NULL DEFAULT '',
  -- Contact is optional and hashed. The network does not need to be able to
  -- email its members; it needs to be able to recognise them.
  email_hash     TEXT,
  disciplines    TEXT NOT NULL DEFAULT '[]',   -- JSON array of discipline keys
  role           TEXT NOT NULL DEFAULT 'member'
                 CHECK (role IN ('member', 'steward', 'admin')),
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'suspended', 'departed')),
  created_at     TEXT NOT NULL,
  last_seen_at   TEXT
);
CREATE INDEX idx_members_status ON members (status);

-- Invite-only membership. One code, one artist, burned on redemption.
CREATE TABLE invites (
  code_hash      TEXT PRIMARY KEY,             -- SHA-256 of the code, never the code
  label          TEXT NOT NULL DEFAULT '',     -- who it was cut for, for the admin's own records
  created_by     TEXT REFERENCES members (id),
  created_at     TEXT NOT NULL,
  expires_at     TEXT,
  redeemed_at    TEXT,
  redeemed_by    TEXT REFERENCES members (id),
  revoked_at     TEXT
);
CREATE INDEX idx_invites_open ON invites (redeemed_at, revoked_at);

CREATE TABLE reports (
  id             TEXT PRIMARY KEY,
  show_id        TEXT NOT NULL,
  author_id      TEXT NOT NULL REFERENCES members (id),
  year           INTEGER NOT NULL,
  discipline     TEXT NOT NULL DEFAULT '',
  price_band     TEXT NOT NULL DEFAULT '',
  -- 'private' is deliberately absent: the API rejects it before it gets here.
  visibility     TEXT NOT NULL
                 CHECK (visibility IN ('anonymous', 'attributed')),
  -- The report body: results, logistics, crowd, factors, wouldReturn, notes.
  -- JSON rather than 40 columns, because the shape will keep moving and the
  -- server only needs to validate it, not query inside it.
  payload        TEXT NOT NULL,
  -- Denormalised for the aggregate queries, which run on every show page.
  gross_sales    REAL,
  net_sales      REAL,
  pieces_sold    INTEGER,
  would_return   TEXT CHECK (would_return IN ('yes', 'maybe', 'no') OR would_return IS NULL),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  deleted_at     TEXT
);
CREATE INDEX idx_reports_show ON reports (show_id, deleted_at);
CREATE INDEX idx_reports_author ON reports (author_id, deleted_at);
CREATE UNIQUE INDEX idx_reports_one_per_year
  ON reports (show_id, author_id, year) WHERE deleted_at IS NULL;

-- Conduct enforcement. The client-side tone check is advisory; this is where a
-- member says "that one crossed the line" and a steward decides.
CREATE TABLE report_flags (
  id             TEXT PRIMARY KEY,
  report_id      TEXT NOT NULL REFERENCES reports (id),
  flagged_by     TEXT NOT NULL REFERENCES members (id),
  reason         TEXT NOT NULL
                 CHECK (reason IN ('personal_attack', 'unverifiable_claim',
                                   'off_topic', 'suspected_false_numbers', 'other')),
  detail         TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  resolved_at    TEXT,
  resolved_by    TEXT REFERENCES members (id),
  resolution     TEXT CHECK (resolution IN ('upheld', 'dismissed', 'edited') OR resolution IS NULL)
);
CREATE INDEX idx_flags_open ON report_flags (resolved_at);

-- Who did what. A network holding other artists' sales figures needs to be
-- able to answer that question later.
CREATE TABLE audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id       TEXT,
  action         TEXT NOT NULL,
  target         TEXT,
  meta           TEXT NOT NULL DEFAULT '{}',
  -- Hashed with a server-side salt: enough to spot one address hammering the
  -- API, not enough to reconstruct where a member lives.
  ip_hash        TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_audit_actor ON audit_log (actor_id, created_at);
CREATE INDEX idx_audit_action ON audit_log (action, created_at);
