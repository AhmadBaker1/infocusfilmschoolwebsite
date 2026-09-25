-- InFocus backend schema (Cloudflare D1 / SQLite).
-- Timestamps are ISO-8601 UTC strings written by the app.

-- ---- Staff accounts + sessions ----

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,            -- stored lower-case
  name TEXT NOT NULL,
  roles TEXT NOT NULL DEFAULT '[]',      -- JSON array: admin | marketing | hr | admissions
  password_hash TEXT,                    -- NULL until the invite is accepted
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
  invite_hash TEXT,                      -- sha256 of the one-time setup token
  invite_expires_at TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  last_login_at TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                   -- sha256 of the cookie token
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT,
  ip TEXT,
  ua TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  ip TEXT,
  ok INTEGER NOT NULL,
  ts TEXT NOT NULL
);
CREATE INDEX login_attempts_ts ON login_attempts(ts);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  action TEXT NOT NULL,                  -- e.g. event.create, job.update, applicant.status
  entity TEXT NOT NULL,                  -- event | job | applicant | admission | user
  entity_id TEXT,
  meta TEXT                              -- JSON
);
CREATE INDEX audit_ts ON audit_log(ts);

-- ---- Marketing: events ----

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL DEFAULT '',
  body_html TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,               -- ISO UTC
  ends_at TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Edmonton',   -- Mountain Time (Calgary)
  location TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'in-person' CHECK (mode IN ('in-person', 'online', 'hybrid')),
  register_url TEXT,
  image_key TEXT,                        -- R2 key under events/
  image_alt TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  featured INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX events_status_start ON events(status, starts_at);

-- ---- HR: job postings + applications ----

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,                   -- slug, used in /careers/<id>
  title TEXT NOT NULL,
  dept TEXT NOT NULL,                    -- leadership | admissions | faculty | marketing | operations
  location TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  pay TEXT NOT NULL DEFAULT '',
  body_md TEXT NOT NULL DEFAULT '',
  html TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'closed')),
  sort INTEGER NOT NULL DEFAULT 0,
  closes_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE job_applications (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,   -- NULL = general application (talent pool)
  role TEXT NOT NULL,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone_country TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  province TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  work_eligible TEXT NOT NULL DEFAULT '',
  resume_key TEXT,                       -- R2 key under applications/
  resume_name TEXT,
  cover_letter_key TEXT,
  cover_letter_name TEXT,
  cover_letter TEXT NOT NULL DEFAULT '',
  portfolio_url TEXT NOT NULL DEFAULT '',
  linkedin_url TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',
  heard_from TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'interview', 'offer', 'hired', 'declined')),
  notes TEXT NOT NULL DEFAULT '',
  ip TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX job_applications_job ON job_applications(job_id, status);
CREATE INDEX job_applications_created ON job_applications(created_at);

-- ---- Admissions: program applications ----

CREATE TABLE admissions_applications (
  id TEXT PRIMARY KEY,
  program TEXT NOT NULL,
  program_name TEXT NOT NULL,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone_country TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  heard_from TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'interview', 'accepted', 'enrolled', 'declined')),
  notes TEXT NOT NULL DEFAULT '',
  ip TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX admissions_created ON admissions_applications(created_at);

-- Public form throttling.
CREATE TABLE submission_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  kind TEXT NOT NULL,
  ts TEXT NOT NULL
);
CREATE INDEX submission_ts ON submission_log(ts);
