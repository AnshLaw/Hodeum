import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SqlDatabase } from "./sql";

const MIGRATIONS = ["0001_skills.sql", "0002_learning.sql"];

/** node:sqlite reads `$1` as a parameter name, so bind by name instead of by position. */
const named = (values: unknown[]): Record<string, SQLInputValue> => Object.fromEntries(values.map((value, i) => [`$${i + 1}`, value as SQLInputValue]));

/** An in-memory database with the app's real migrations, for store tests. */
export function testDatabase(): SqlDatabase {
  const db = new DatabaseSync(":memory:");
  for (const file of MIGRATIONS) db.exec(readFileSync(resolve(import.meta.dirname, "../../src-tauri/migrations", file), "utf8"));
  return {
    async select<T>(query: string, values: unknown[] = []) {
      return db.prepare(query).all(named(values)) as T;
    },
    async execute(query: string, values: unknown[] = []) {
      return { rowsAffected: Number(db.prepare(query).run(named(values)).changes) };
    },
  };
}
