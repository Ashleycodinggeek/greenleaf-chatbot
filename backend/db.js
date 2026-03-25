// db.js
// Database using sql.js — pure JavaScript SQLite, no compilation needed.
// Compatible with Node.js v25+

const initSqlJs = require('sql.js');
const path      = require('path');
const fs        = require('fs');

const DB_PATH = process.env.DB_PATH || './data/chatbot.db';

// Ensure /data folder exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

let db; // will be set after async init

// ── Schema ────────────────────────────────────────────────────────────────────
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at    TEXT,
    ip_hash     TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT NOT NULL,
    role          TEXT NOT NULL,
    content       TEXT NOT NULL,
    intent        TEXT,
    escalated     INTEGER NOT NULL DEFAULT 0,
    response_ms   INTEGER,
    token_input   INTEGER,
    token_output  INTEGER,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL,
    rating      INTEGER,
    comment     TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_msg_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_msg_intent  ON messages(intent);
`;

// ── Save db to disk after every write ─────────────────────────────────────────
function persist() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// ── Run a write query (INSERT / UPDATE) ───────────────────────────────────────
function run(sql, params = []) {
  db.run(sql, params);
  persist();
}

// ── Get one row ───────────────────────────────────────────────────────────────
function get(sql, params = []) {
  const stmt   = db.prepare(sql);
  const result = stmt.getAsObject(params);
  stmt.free();
  // sql.js returns {} when nothing found — return null instead
  return Object.keys(result).length === 0 ? null : result;
}

// ── Get multiple rows ─────────────────────────────────────────────────────────
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// ── Initialise — must be called before server starts ─────────────────────────
async function initDb() {
  const SQL = await initSqlJs();

  // Load existing database file if it exists, otherwise create fresh
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(SCHEMA);
  persist();
  console.log(`   Database    → ${DB_PATH}`);
}

// ── Query helpers (same interface the rest of the code expects) ───────────────
const queries = {
  createSession(id, ipHash) {
    run(
      `INSERT INTO sessions (id, ip_hash) VALUES (?, ?)`,
      [id, ipHash]
    );
  },

  getSession(id) {
    return get(`SELECT * FROM sessions WHERE id = ?`, [id]);
  },

  endSession(id) {
    run(
      `UPDATE sessions SET ended_at = datetime('now') WHERE id = ?`,
      [id]
    );
  },

  saveMessage({ session_id, role, content, intent, escalated, response_ms, token_input, token_output }) {
    run(
      `INSERT INTO messages
         (session_id, role, content, intent, escalated, response_ms, token_input, token_output)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [session_id, role, content, intent, escalated, response_ms, token_input, token_output]
    );
  },

  getHistory(session_id) {
    return all(
      `SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC`,
      [session_id]
    );
  },

  getSessionMessages(session_id) {
    return all(
      `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`,
      [session_id]
    );
  },

  sessionStats(session_id) {
    return get(
      `SELECT
         COUNT(*)                                              AS total_turns,
         SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END)  AS bot_turns,
         SUM(escalated)                                        AS escalations,
         AVG(CASE WHEN response_ms IS NOT NULL THEN response_ms END) AS avg_response_ms,
         MIN(response_ms)                                      AS min_response_ms,
         MAX(response_ms)                                      AS max_response_ms
       FROM messages WHERE session_id = ?`,
      [session_id]
    );
  },

  intentBreakdown(session_id) {
    return all(
      `SELECT intent, COUNT(*) AS count
       FROM messages WHERE session_id = ? AND role = 'user'
       GROUP BY intent`,
      [session_id]
    );
  },

  saveFeedback(session_id, rating, comment) {
    run(
      `INSERT INTO feedback (session_id, rating, comment) VALUES (?, ?, ?)`,
      [session_id, rating, comment]
    );
  },
};

module.exports = { initDb, queries };