-- End-of-Hode learning summaries (PRD 18.1): skill ids, step objectives and counts only; never a
-- transcript, audio or screenshot. Lists are JSON arrays.
CREATE TABLE learning_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hode TEXT NOT NULL,
  completed INTEGER NOT NULL,
  skills TEXT NOT NULL,
  needed_help_with TEXT NOT NULL,
  independent_steps INTEGER NOT NULL,
  guided_steps INTEGER NOT NULL,
  preferred_language TEXT NOT NULL,
  next_assistance_level TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX learning_summaries_at ON learning_summaries (at);
