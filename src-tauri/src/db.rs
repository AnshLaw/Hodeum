use tauri_plugin_sql::{Migration, MigrationKind};

/// Lives in the app config directory, never in the repository. Must match `src/providers/sqlite-skill-store.ts`.
pub const DATABASE_URL: &str = "sqlite:hodeum.db";

pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create_skill_tables",
        sql: "CREATE TABLE skills (
                skill_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                confidence REAL NOT NULL,
                success_count INTEGER NOT NULL,
                failure_count INTEGER NOT NULL,
                last_assistance_level TEXT NOT NULL,
                last_seen_at TEXT NOT NULL
              );
              CREATE TABLE step_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                skill_id TEXT NOT NULL,
                completed INTEGER NOT NULL,
                mistakes INTEGER NOT NULL,
                level TEXT NOT NULL,
                escalated INTEGER NOT NULL,
                at TEXT NOT NULL
              );",
        kind: MigrationKind::Up,
    }]
}
