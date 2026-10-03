/** Must match `DATABASE_URL` in src-tauri/src/db.rs, which owns the migrations. */
export const DATABASE_URL = "sqlite:hodeum.db";

/** The slice of `@tauri-apps/plugin-sql` the stores use; `$1, $2…` placeholders, in order. */
export interface SqlDatabase {
  select<T>(query: string, values?: unknown[]): Promise<T>;
  execute(query: string, values?: unknown[]): Promise<{ rowsAffected: number }>;
}

/** Tauri only. Every window shares the one connection pool the SQL plugin keeps per database. */
export async function openDatabase(): Promise<SqlDatabase> {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  return Database.load(DATABASE_URL);
}
