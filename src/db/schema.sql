CREATE TABLE IF NOT EXISTS sim_days (
  day           INTEGER PRIMARY KEY,
  capital       REAL    NOT NULL,
  reputation    REAL    NOT NULL,
  dau           INTEGER NOT NULL,
  subscribers   INTEGER NOT NULL,
  ad_revenue    REAL    NOT NULL,
  llm_cost      REAL    NOT NULL,
  is_board_day  INTEGER NOT NULL DEFAULT 0,
  editor_note   TEXT,
  completed_at  TEXT
);

CREATE TABLE IF NOT EXISTS work_events (
  id          TEXT PRIMARY KEY,
  day         INTEGER NOT NULL,
  seq         INTEGER NOT NULL,
  ts          TEXT NOT NULL,
  actor_id    TEXT NOT NULL,
  actor_name  TEXT NOT NULL,
  actor_type  TEXT NOT NULL,
  layer       TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  action      TEXT NOT NULL,
  content     TEXT,
  payload     TEXT,
  refs        TEXT,
  cost_token  INTEGER NOT NULL DEFAULT 0,
  cost_yuan   REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS published_articles (
  id             TEXT    PRIMARY KEY,
  day            INTEGER NOT NULL,
  source_id      TEXT    NOT NULL,
  title_zh       TEXT    NOT NULL,
  summary_zh     TEXT    NOT NULL,
  content_zh     TEXT    NOT NULL,
  source_url     TEXT    NOT NULL,
  image_url      TEXT,
  tags           TEXT,
  quality_score  REAL    NOT NULL,
  quality_reason TEXT    NOT NULL,
  created_at     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sim_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS board_directives (
  id         TEXT PRIMARY KEY,
  day        INTEGER NOT NULL,
  directive  TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS board_meetings (
  day           INTEGER PRIMARY KEY,
  status        TEXT NOT NULL,
  weekly_report TEXT NOT NULL,
  auto_directive TEXT,
  auto_directive_reason TEXT,
  directive     TEXT,
  suspended_at  TEXT NOT NULL,
  resumed_at    TEXT
);

CREATE TABLE IF NOT EXISTS layer_snapshots (
  layer      TEXT NOT NULL,
  day        INTEGER NOT NULL,
  entity_id  TEXT NOT NULL,
  payload    TEXT NOT NULL,
  PRIMARY KEY (layer, day, entity_id)
);

CREATE TABLE IF NOT EXISTS layer_changes (
  id              TEXT PRIMARY KEY,
  layer           TEXT NOT NULL,
  day             INTEGER NOT NULL,
  entity_table    TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  change_type     TEXT NOT NULL,
  before_json     TEXT,
  after_json      TEXT,
  caused_by_event TEXT NOT NULL,
  summary         TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mission_charter (
  id          TEXT PRIMARY KEY,
  statement   TEXT NOT NULL,
  values_json TEXT NOT NULL,
  locked      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mission_strategy (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  description    TEXT NOT NULL,
  effective_from INTEGER NOT NULL,
  effective_to   INTEGER,
  status         TEXT NOT NULL,
  superseded_by  TEXT
);

CREATE TABLE IF NOT EXISTS mission_okr (
  id             TEXT PRIMARY KEY,
  stage          INTEGER NOT NULL,
  metric         TEXT NOT NULL,
  target         REAL NOT NULL,
  upper_bound    REAL,
  effective_from INTEGER NOT NULL,
  status         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mission_okr_progress (
  day     INTEGER NOT NULL,
  okr_id  TEXT NOT NULL,
  current REAL NOT NULL,
  gap     REAL NOT NULL,
  PRIMARY KEY (day, okr_id)
);

CREATE TABLE IF NOT EXISTS tool_registry (
  id          TEXT PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  kind        TEXT NOT NULL,
  scope       TEXT NOT NULL,
  description TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  status      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_grants (
  employee_id TEXT NOT NULL,
  tool_id     TEXT NOT NULL,
  budget_yuan REAL,
  granted_at  TEXT NOT NULL,
  revoked_at  TEXT,
  PRIMARY KEY (employee_id, tool_id)
);

CREATE TABLE IF NOT EXISTS tool_calls (
  event_id    TEXT PRIMARY KEY,
  day         INTEGER NOT NULL,
  employee_id TEXT NOT NULL,
  tool_id     TEXT NOT NULL,
  args_json   TEXT NOT NULL,
  result_json TEXT,
  ok          INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  cost_yuan   REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_entries (
  id             TEXT PRIMARY KEY,
  type           TEXT NOT NULL,
  key            TEXT NOT NULL,
  body_json      TEXT NOT NULL,
  weight         REAL NOT NULL,
  status         TEXT NOT NULL,
  first_seen_day INTEGER NOT NULL,
  last_used_day  INTEGER,
  origin_event   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_writes (
  event_id    TEXT PRIMARY KEY,
  day         INTEGER NOT NULL,
  employee_id TEXT NOT NULL,
  entry_id    TEXT NOT NULL,
  op          TEXT NOT NULL,
  delta_json  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_reads (
  event_id    TEXT PRIMARY KEY,
  day         INTEGER NOT NULL,
  employee_id TEXT NOT NULL,
  entry_id    TEXT NOT NULL,
  context     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_links (
  day          INTEGER NOT NULL,
  entry_id     TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  relation     TEXT NOT NULL,
  caused_by    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id              TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  role_template   TEXT NOT NULL,
  status          TEXT NOT NULL,
  joined_day      INTEGER NOT NULL,
  left_day        INTEGER,
  system_prompt   TEXT NOT NULL,
  soul            TEXT,
  tools_granted   TEXT,
  memory          TEXT,
  agent_handle    TEXT NOT NULL,
  caused_by_event TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS org_relations (
  id              TEXT PRIMARY KEY,
  superior_id     TEXT NOT NULL,
  subordinate_id  TEXT NOT NULL,
  effective_from  INTEGER NOT NULL,
  effective_to    INTEGER
);

CREATE TABLE IF NOT EXISTS employee_responsibilities (
  employee_id    TEXT NOT NULL,
  responsibility TEXT NOT NULL,
  effective_from INTEGER NOT NULL,
  effective_to   INTEGER,
  PRIMARY KEY (employee_id, responsibility, effective_from)
);

CREATE TABLE IF NOT EXISTS employee_daily_contribution (
  day         INTEGER NOT NULL,
  employee_id TEXT NOT NULL,
  summary     TEXT NOT NULL,
  decisions   INTEGER NOT NULL,
  tool_calls  INTEGER NOT NULL,
  cost_yuan   REAL NOT NULL,
  output_refs TEXT,
  PRIMARY KEY (day, employee_id)
);

CREATE TABLE IF NOT EXISTS rules (
  id             TEXT PRIMARY KEY,
  code           TEXT UNIQUE NOT NULL,
  category       TEXT NOT NULL,
  text           TEXT NOT NULL,
  threshold_json TEXT,
  effective_from INTEGER NOT NULL,
  status         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rule_executions (
  event_id   TEXT PRIMARY KEY,
  day        INTEGER NOT NULL,
  rule_id    TEXT NOT NULL,
  outcome    TEXT NOT NULL,
  target_ref TEXT,
  notes      TEXT
);

CREATE TABLE IF NOT EXISTS resource_metrics (
  metric      TEXT PRIMARY KEY,
  value       REAL NOT NULL,
  updated_day INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_settlement (
  day               INTEGER PRIMARY KEY,
  revenue_breakdown TEXT NOT NULL,
  cost_breakdown    TEXT NOT NULL,
  capital_delta     REAL NOT NULL,
  reputation_delta  REAL NOT NULL,
  dau_delta         INTEGER NOT NULL,
  subscribers_delta INTEGER NOT NULL,
  settled_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settlement_drivers (
  day              INTEGER NOT NULL,
  metric           TEXT NOT NULL,
  factor           TEXT NOT NULL,
  delta            REAL NOT NULL,
  caused_by_event  TEXT NOT NULL,
  PRIMARY KEY (day, metric, factor)
);

CREATE TABLE IF NOT EXISTS ad_inventory (
  id       TEXT PRIMARY KEY,
  slot_code TEXT NOT NULL,
  cpm_base REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS ad_placements (
  id              TEXT PRIMARY KEY,
  day             INTEGER NOT NULL,
  slot_id         TEXT NOT NULL,
  advertiser      TEXT NOT NULL,
  payload         TEXT NOT NULL,
  revenue         REAL NOT NULL,
  caused_by_event TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS growth_signals (
  id              TEXT PRIMARY KEY,
  day             INTEGER NOT NULL,
  type            TEXT NOT NULL,
  metric_refs     TEXT NOT NULL,
  description     TEXT NOT NULL,
  caused_by_event TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS growth_proposals (
  id           TEXT PRIMARY KEY,
  day          INTEGER NOT NULL,
  signal_id    TEXT,
  proposer_id  TEXT NOT NULL,
  scope        TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS growth_decisions (
  proposal_id     TEXT PRIMARY KEY,
  decided_by      TEXT NOT NULL,
  decided_day     INTEGER NOT NULL,
  outcome         TEXT NOT NULL,
  notes           TEXT,
  caused_by_event TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS growth_observations (
  employee_id TEXT NOT NULL,
  day         INTEGER NOT NULL,
  kpi_json    TEXT NOT NULL,
  status      TEXT NOT NULL,
  PRIMARY KEY (employee_id, day)
);

CREATE VIEW IF NOT EXISTS sim_events AS
SELECT
  id,
  day,
  seq,
  actor_id AS agent_id,
  actor_name AS agent_name,
  event_type,
  COALESCE(content, '') AS content,
  payload AS metadata,
  created_at
FROM work_events;

CREATE INDEX IF NOT EXISTS idx_work_events_day_seq ON work_events(day, seq);
CREATE INDEX IF NOT EXISTS idx_work_events_actor ON work_events(actor_id);
CREATE INDEX IF NOT EXISTS idx_work_events_layer ON work_events(layer, day);
CREATE INDEX IF NOT EXISTS idx_layer_changes_day ON layer_changes(layer, day);
CREATE INDEX IF NOT EXISTS idx_articles_day ON published_articles(day);
CREATE INDEX IF NOT EXISTS idx_days_completed ON sim_days(completed_at);

CREATE TABLE IF NOT EXISTS employee_soul_snapshots (
  id          TEXT    PRIMARY KEY,
  employee_id TEXT    NOT NULL,
  day         INTEGER NOT NULL,
  soul_md     TEXT    NOT NULL,
  memory_md   TEXT    NOT NULL,
  created_at  TEXT    NOT NULL,
  UNIQUE(employee_id, day)
);

CREATE INDEX IF NOT EXISTS idx_soul_snapshots_employee ON employee_soul_snapshots(employee_id, day);

