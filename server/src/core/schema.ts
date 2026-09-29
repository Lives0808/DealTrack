/**
 * DealTrack schema.
 *
 * Design notes
 * ------------
 * - Every table uses TEXT ids generated in the app (`uid()`), not AUTOINCREMENT,
 *   so the same code runs on PostgreSQL without change.
 * - Timestamps are ISO-8601 UTC TEXT. Sortable, comparable, timezone-proof.
 * - Structured JSON (parsed inquiry, tags, certifications) is stored as TEXT and
 *   read back through `parseJson()`. SQLite's JSON1 functions are available when
 *   we need to query inside them.
 * - The `events` + `agent_tasks` + `agent_runs` trio is the event-driven backbone:
 *   something happens → an event is written → the orchestrator enqueues work →
 *   an agent runs → it writes more events. Everything an agent does is auditable.
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ===========================================================================
-- Identity & configuration
-- ===========================================================================

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE,
  role          TEXT NOT NULL DEFAULT 'sales',   -- owner | ops | sales
  language      TEXT NOT NULL DEFAULT 'zh',
  avatar_color  TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  encrypted   INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL
);

-- ===========================================================================
-- Product library & pricing rules
-- ===========================================================================

CREATE TABLE IF NOT EXISTS products (
  id                TEXT PRIMARY KEY,
  sku               TEXT NOT NULL UNIQUE,
  name_en           TEXT NOT NULL,
  name_zh           TEXT,
  category          TEXT,
  description_en    TEXT,
  description_zh    TEXT,
  unit              TEXT NOT NULL DEFAULT 'pcs',
  moq               INTEGER NOT NULL DEFAULT 1,
  hs_code           TEXT,
  hs_description    TEXT,
  net_weight_kg     REAL,
  gross_weight_kg   REAL,
  cbm               REAL,
  certifications    TEXT NOT NULL DEFAULT '[]',  -- ["CE","RoHS","FCC"]
  target_markets    TEXT NOT NULL DEFAULT '[]',  -- ["DE","US","BR"]
  spec              TEXT NOT NULL DEFAULT '{}',  -- free-form spec sheet
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

-- Quantity-tiered cost + target margin. The pricing engine walks these to build
-- FOB / CIF quotes; everything is stored so the boss can audit any price.
CREATE TABLE IF NOT EXISTS price_tiers (
  id              TEXT PRIMARY KEY,
  product_id      TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  min_qty         INTEGER NOT NULL DEFAULT 1,
  unit_cost       REAL NOT NULL,
  cost_currency   TEXT NOT NULL DEFAULT 'CNY',
  margin_pct      REAL NOT NULL DEFAULT 0.18,
  list_price      REAL,                       -- optional fixed export price
  currency        TEXT NOT NULL DEFAULT 'USD',
  incoterm        TEXT NOT NULL DEFAULT 'FOB',
  packaging_cost  REAL NOT NULL DEFAULT 0,
  inland_cost     REAL NOT NULL DEFAULT 0,
  lead_time_days  INTEGER NOT NULL DEFAULT 15,
  valid_from      TEXT,
  valid_to        TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_tiers_product ON price_tiers(product_id, min_qty);

CREATE TABLE IF NOT EXISTS fx_rates (
  base        TEXT NOT NULL,
  quote       TEXT NOT NULL,
  rate        REAL NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (base, quote)
);

-- Declarative discount / surcharge rules evaluated by the pricing engine.
CREATE TABLE IF NOT EXISTS price_rules (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  priority     INTEGER NOT NULL DEFAULT 100,
  scope        TEXT NOT NULL DEFAULT 'quote',  -- quote | line | customer
  condition    TEXT NOT NULL DEFAULT '{}',     -- {"field":"qty","op":">=","value":1000}
  action       TEXT NOT NULL DEFAULT '{}',     -- {"type":"margin_delta","value":-0.02}
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- ===========================================================================
-- Customers
-- ===========================================================================

CREATE TABLE IF NOT EXISTS customers (
  id            TEXT PRIMARY KEY,
  company       TEXT NOT NULL,
  country       TEXT,
  country_code  TEXT,
  contact_name  TEXT,
  email         TEXT,
  phone         TEXT,
  whatsapp      TEXT,
  website       TEXT,
  language      TEXT DEFAULT 'en',
  timezone      TEXT,
  source        TEXT DEFAULT 'inbound',
  status        TEXT NOT NULL DEFAULT 'lead',  -- lead|prospect|active|dormant|blocked
  tier          TEXT NOT NULL DEFAULT 'standard',
  tags          TEXT NOT NULL DEFAULT '[]',
  preferences   TEXT NOT NULL DEFAULT '{}',
  notes         TEXT,
  owner_id      TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(lower(email));
CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);

-- ===========================================================================
-- Inquiries (询盘) — the unit of work
-- ===========================================================================

CREATE TABLE IF NOT EXISTS inquiries (
  id                     TEXT PRIMARY KEY,
  code                   TEXT NOT NULL UNIQUE,
  customer_id            TEXT REFERENCES customers(id),
  channel                TEXT NOT NULL DEFAULT 'email',  -- email|whatsapp|web|manual
  direction              TEXT NOT NULL DEFAULT 'inbound',
  subject                TEXT,
  body                   TEXT,
  raw                    TEXT,
  from_email             TEXT,
  from_name              TEXT,
  from_phone             TEXT,
  language               TEXT,
  detected_intent        TEXT,
  status                 TEXT NOT NULL DEFAULT 'new',
      -- new|parsed|quoted|nurturing|won|lost|archived
  priority               TEXT NOT NULL DEFAULT 'normal', -- low|normal|high|urgent
  owner_id               TEXT REFERENCES users(id),
  parsed                 TEXT,             -- SalesAgent extraction output
  parse_confidence       REAL,
  product_matches        TEXT NOT NULL DEFAULT '[]',
  missing_info           TEXT NOT NULL DEFAULT '[]',
  summary_zh             TEXT,
  attachments            TEXT NOT NULL DEFAULT '[]',
  message_id             TEXT,
  thread_id              TEXT,
  received_at            TEXT NOT NULL,
  first_response_at      TEXT,
  first_response_seconds INTEGER,
  quoted_at              TEXT,
  won_at                 TEXT,
  lost_at                TEXT,
  sla_due_at             TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_inquiries_customer ON inquiries(customer_id);
CREATE INDEX IF NOT EXISTS idx_inquiries_email ON inquiries(lower(from_email));
CREATE INDEX IF NOT EXISTS idx_inquiries_sla ON inquiries(sla_due_at);

CREATE TABLE IF NOT EXISTS inquiry_items (
  id                TEXT PRIMARY KEY,
  inquiry_id        TEXT NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  line_no           INTEGER NOT NULL DEFAULT 1,
  raw_text          TEXT,
  product_id        TEXT REFERENCES products(id),
  sku               TEXT,
  description       TEXT,
  qty               REAL,
  unit              TEXT,
  target_price      REAL,
  currency          TEXT,
  lead_time_days    INTEGER,
  match_confidence  REAL,
  notes             TEXT
);
CREATE INDEX IF NOT EXISTS idx_inquiry_items_inquiry ON inquiry_items(inquiry_id);

-- ===========================================================================
-- Quotes (报价单) & outcomes (成交 / 丢单)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS quotes (
  id               TEXT PRIMARY KEY,
  quote_no         TEXT NOT NULL UNIQUE,
  inquiry_id       TEXT REFERENCES inquiries(id),
  customer_id      TEXT NOT NULL REFERENCES customers(id),
  version          INTEGER NOT NULL DEFAULT 1,
  parent_quote_id  TEXT,
  currency         TEXT NOT NULL DEFAULT 'USD',
  incoterm         TEXT NOT NULL DEFAULT 'FOB',
  incoterm_place   TEXT NOT NULL DEFAULT 'Shenzhen',
  valid_until      TEXT,
  payment_terms    TEXT DEFAULT '30% T/T deposit, 70% before shipment',
  lead_time_days   INTEGER DEFAULT 15,
  moq              INTEGER,
  subtotal         REAL NOT NULL DEFAULT 0,
  discount_pct     REAL NOT NULL DEFAULT 0,
  discount_amount  REAL NOT NULL DEFAULT 0,
  freight          REAL NOT NULL DEFAULT 0,
  insurance        REAL NOT NULL DEFAULT 0,
  other_fees       REAL NOT NULL DEFAULT 0,
  total            REAL NOT NULL DEFAULT 0,
  cost_total       REAL NOT NULL DEFAULT 0,
  margin_pct       REAL,
  margin_amount    REAL,
  status           TEXT NOT NULL DEFAULT 'draft',
      -- draft|pending_approval|sent|accepted|rejected|expired|superseded
  language         TEXT NOT NULL DEFAULT 'en',
  price_breakdown  TEXT NOT NULL DEFAULT '[]',
  applied_rules    TEXT NOT NULL DEFAULT '[]',
  created_by       TEXT NOT NULL DEFAULT 'agent:sales',
  approved_by      TEXT,
  approved_at      TEXT,
  sent_at          TEXT,
  notes            TEXT,
  internal_notes   TEXT,
  pdf_path         TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_customer ON quotes(customer_id);
CREATE INDEX IF NOT EXISTS idx_quotes_inquiry ON quotes(inquiry_id);

CREATE TABLE IF NOT EXISTS quote_items (
  id                TEXT PRIMARY KEY,
  quote_id          TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  line_no           INTEGER NOT NULL DEFAULT 1,
  product_id        TEXT REFERENCES products(id),
  sku               TEXT,
  description       TEXT NOT NULL,
  description_i18n  TEXT NOT NULL DEFAULT '{}',
  qty               REAL NOT NULL,
  unit              TEXT NOT NULL DEFAULT 'pcs',
  unit_price        REAL NOT NULL,
  amount            REAL NOT NULL,
  unit_cost         REAL,
  cost_currency     TEXT,
  currency          TEXT,
  hs_code           TEXT,
  lead_time_days    INTEGER,
  notes             TEXT
);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);

CREATE TABLE IF NOT EXISTS quote_outcomes (
  id            TEXT PRIMARY KEY,
  quote_id      TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  inquiry_id    TEXT REFERENCES inquiries(id),
  customer_id   TEXT REFERENCES customers(id),
  result        TEXT NOT NULL,     -- won|lost|no_response|pending
  reason_code   TEXT,              -- price|lead_time|quality|payment_terms|moq|certification|shipping|competitor|no_budget|other
  reason_note   TEXT,
  competitor    TEXT,
  final_price   REAL,
  decided_by    TEXT,
  decided_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outcomes_result ON quote_outcomes(result, reason_code);

-- ===========================================================================
-- Follow-ups (跟进) — "不漏跟" lives here
-- ===========================================================================

CREATE TABLE IF NOT EXISTS followups (
  id               TEXT PRIMARY KEY,
  inquiry_id       TEXT REFERENCES inquiries(id),
  quote_id         TEXT REFERENCES quotes(id),
  customer_id      TEXT NOT NULL REFERENCES customers(id),
  sequence_no      INTEGER NOT NULL DEFAULT 1,
  channel          TEXT NOT NULL DEFAULT 'email',
  due_at           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'scheduled',
      -- scheduled|pending_approval|sent|replied|snoozed|skipped|done|failed
  reason           TEXT,
  intent           TEXT,
  template_id      TEXT REFERENCES playbooks(id),
  language         TEXT NOT NULL DEFAULT 'en',
  subject          TEXT,
  body             TEXT,
  assigned_to      TEXT REFERENCES users(id),
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_attempt_at  TEXT,
  snoozed_until    TEXT,
  escalated_at     TEXT,
  completed_at     TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_followups_due ON followups(status, due_at);
CREATE INDEX IF NOT EXISTS idx_followups_inquiry ON followups(inquiry_id);
CREATE INDEX IF NOT EXISTS idx_followups_customer ON followups(customer_id);

CREATE TABLE IF NOT EXISTS outbound_messages (
  id                   TEXT PRIMARY KEY,
  channel              TEXT NOT NULL,          -- email|whatsapp
  direction            TEXT NOT NULL DEFAULT 'outbound',
  inquiry_id           TEXT REFERENCES inquiries(id),
  quote_id             TEXT REFERENCES quotes(id),
  customer_id          TEXT REFERENCES customers(id),
  followup_id          TEXT REFERENCES followups(id),
  to_addr              TEXT NOT NULL,
  from_addr            TEXT,
  subject              TEXT,
  body                 TEXT NOT NULL,
  body_html            TEXT,
  language             TEXT,
  status               TEXT NOT NULL DEFAULT 'draft',
      -- draft|pending_approval|queued|sent|failed
  provider             TEXT,
  provider_message_id  TEXT,
  error                TEXT,
  created_by           TEXT,
  approved_by          TEXT,
  approved_at          TEXT,
  sent_at              TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbound_status ON outbound_messages(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_inquiry ON outbound_messages(inquiry_id);

-- ===========================================================================
-- Playbooks (话术库) — the closing playbook the boss keeps tuning
-- ===========================================================================

CREATE TABLE IF NOT EXISTS playbooks (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  category      TEXT,
  stage         TEXT NOT NULL DEFAULT 'first_reply',
      -- first_reply|quote_cover|quote_followup|objection_price|objection_leadtime
      -- |objection_moq|reengagement|thank_you|shipping_update|payment_reminder
  channel       TEXT NOT NULL DEFAULT 'email',
  language      TEXT NOT NULL DEFAULT 'en',
  subject_tpl   TEXT,
  body_tpl      TEXT NOT NULL,
  variables     TEXT NOT NULL DEFAULT '[]',
  tags          TEXT NOT NULL DEFAULT '[]',
  usage_count   INTEGER NOT NULL DEFAULT 0,
  reply_count   INTEGER NOT NULL DEFAULT 0,
  win_count     INTEGER NOT NULL DEFAULT 0,
  builtin       INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_playbooks_stage ON playbooks(stage, language);

-- ===========================================================================
-- Event-driven backbone
-- ===========================================================================

CREATE TABLE IF NOT EXISTS events (
  id              TEXT PRIMARY KEY,
  seq             INTEGER,
  type            TEXT NOT NULL,
  actor           TEXT NOT NULL,      -- agent:sales | user:<id> | system | integration:imap
  entity_type     TEXT,
  entity_id       TEXT,
  subject         TEXT,
  payload         TEXT NOT NULL DEFAULT '{}',
  correlation_id  TEXT,
  causation_id    TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_entity ON events(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_correlation ON events(correlation_id);

CREATE TABLE IF NOT EXISTS agent_tasks (
  id              TEXT PRIMARY KEY,
  agent           TEXT NOT NULL,
  task_type       TEXT NOT NULL,
  payload         TEXT NOT NULL DEFAULT '{}',
  priority        INTEGER NOT NULL DEFAULT 100,
  status          TEXT NOT NULL DEFAULT 'queued',
      -- queued|running|succeeded|failed|dead|cancelled|waiting_approval
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  dedupe_key      TEXT,
  run_after       TEXT,
  locked_at       TEXT,
  locked_by       TEXT,
  last_error      TEXT,
  result          TEXT,
  event_id        TEXT,
  correlation_id  TEXT,
  started_at      TEXT,
  finished_at     TEXT,
  duration_ms     INTEGER,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_pick ON agent_tasks(status, run_after, priority);
CREATE INDEX IF NOT EXISTS idx_tasks_agent ON agent_tasks(agent, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_dedupe
  ON agent_tasks(dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('queued','running');

CREATE TABLE IF NOT EXISTS agent_runs (
  id               TEXT PRIMARY KEY,
  agent            TEXT NOT NULL,
  task_id          TEXT,
  status           TEXT NOT NULL,   -- running|succeeded|failed|waiting_approval
  trigger_event_id TEXT,
  input            TEXT,
  output           TEXT,
  provider         TEXT,
  model            TEXT,
  tokens_in        INTEGER NOT NULL DEFAULT 0,
  tokens_out       INTEGER NOT NULL DEFAULT 0,
  cost_usd         REAL NOT NULL DEFAULT 0,
  latency_ms       INTEGER,
  error            TEXT,
  started_at       TEXT NOT NULL,
  finished_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_agent ON agent_runs(agent, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON agent_runs(status);

CREATE TABLE IF NOT EXISTS agent_state (
  agent            TEXT PRIMARY KEY,
  label            TEXT,
  status           TEXT NOT NULL DEFAULT 'idle',  -- idle|busy|paused|error
  current_task_id  TEXT,
  last_heartbeat   TEXT,
  processed_count  INTEGER NOT NULL DEFAULT 0,
  failed_count     INTEGER NOT NULL DEFAULT 0,
  total_tokens     INTEGER NOT NULL DEFAULT 0,
  total_cost_usd   REAL NOT NULL DEFAULT 0,
  enabled          INTEGER NOT NULL DEFAULT 1
);

-- Internal "业务对齐群": when a lead goes quiet or a lead-time risk appears,
-- the Follow-up Agent opens a thread and pulls the humans in.
CREATE TABLE IF NOT EXISTS threads (
  id           TEXT PRIMARY KEY,
  subject      TEXT NOT NULL,
  topic        TEXT,
  entity_type  TEXT,
  entity_id    TEXT,
  status       TEXT NOT NULL DEFAULT 'open',   -- open|resolved
  severity     TEXT NOT NULL DEFAULT 'normal', -- info|normal|warning|critical
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS thread_messages (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  author      TEXT NOT NULL,
  role        TEXT,
  body        TEXT NOT NULL,
  mentions    TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_thread_messages ON thread_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS alerts (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL,
  severity         TEXT NOT NULL DEFAULT 'warning',
  title            TEXT NOT NULL,
  body             TEXT,
  entity_type      TEXT,
  entity_id        TEXT,
  acknowledged     INTEGER NOT NULL DEFAULT 0,
  acknowledged_by  TEXT,
  acknowledged_at  TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_open ON alerts(acknowledged, created_at DESC);

-- ===========================================================================
-- Attachments / OCR
-- ===========================================================================

CREATE TABLE IF NOT EXISTS attachments (
  id           TEXT PRIMARY KEY,
  inquiry_id   TEXT REFERENCES inquiries(id) ON DELETE CASCADE,
  message_id   TEXT,
  filename     TEXT NOT NULL,
  mime         TEXT,
  size         INTEGER,
  path         TEXT,
  ocr_status   TEXT NOT NULL DEFAULT 'pending', -- pending|done|skipped|failed
  ocr_text     TEXT,
  extracted    TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_inquiry ON attachments(inquiry_id);

-- ===========================================================================
-- LLM accounting (BYOK cost visibility)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS llm_usage (
  id          TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  model       TEXT,
  agent       TEXT,
  task_id     TEXT,
  operation   TEXT,
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0,
  cost_usd    REAL NOT NULL DEFAULT 0,
  latency_ms  INTEGER,
  ok          INTEGER NOT NULL DEFAULT 1,
  error       TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_usage_created ON llm_usage(created_at DESC);

-- IMAP / WhatsApp sync cursors
CREATE TABLE IF NOT EXISTS sync_state (
  id          TEXT PRIMARY KEY,
  cursor      TEXT,
  last_run_at TEXT,
  last_error  TEXT,
  stats       TEXT NOT NULL DEFAULT '{}'
);
`;

/** Applied in order; each entry is a forward-only migration. */
export const MIGRATIONS: Array<{ version: number; name: string; sql: string }> = [
  { version: 1, name: 'initial_schema', sql: SCHEMA_SQL },
];
