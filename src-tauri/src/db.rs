use tauri_plugin_sql::{Migration, MigrationKind};

/// Lives in the app config directory, never in the repository. Must match `src/data/sql.ts`.
pub const DATABASE_URL: &str = "sqlite:hodeum.db";

/// The SQL lives in `migrations/` so the TypeScript store tests run against the same schema.
pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_skill_tables",
            sql: include_str!("../migrations/0001_skills.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_learning_tables",
            sql: include_str!("../migrations/0002_learning.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "chat_web_sources",
            sql: include_str!("../migrations/0003_chat_web.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::migrations;

    /// sqlx checksums applied migrations: a CRLF checkout would make existing databases refuse to open.
    #[test]
    fn migrations_use_lf_line_endings() {
        for migration in migrations() {
            assert!(!migration.sql.contains('\r'), "migration {} has CRLF line endings", migration.version);
        }
    }
}
