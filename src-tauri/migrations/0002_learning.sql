-- Learning history, chats and settings. No screenshots, audio or transcripts are ever stored.
CREATE TABLE hodes (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  pack_id TEXT,
  open INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  outcome TEXT
);
CREATE INDEX hodes_started_at ON hodes (started_at);
CREATE TABLE hode_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hode_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT,
  at TEXT NOT NULL
);
CREATE INDEX hode_events_hode_id ON hode_events (hode_id);
CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  context TEXT,
  at TEXT NOT NULL
);
CREATE INDEX chat_messages_chat_id ON chat_messages (chat_id, at);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
