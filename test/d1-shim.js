// Imitación mínima de la API de Cloudflare D1 sobre node:sqlite, solo para los tests.
// Aplica las mismas migraciones de /migrations que usa D1 en Cloudflare.

import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const returnsRows = (sql) => /^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    for (const p of params) {
      if (p === undefined) throw new Error("D1_TYPE_ERROR: undefined no es un valor válido para bind()");
    }
    return new Statement(this.db, this.sql, params);
  }
  _exec() {
    const stmt = this.db.prepare(this.sql);
    if (returnsRows(this.sql)) {
      const results = stmt.all(...this.params);
      return { results, success: true, meta: { changes: results.length } };
    }
    const info = stmt.run(...this.params);
    return { results: [], success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }
  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.params) ?? null;
    if (row && column) return row[column] ?? null;
    return row;
  }
  async all() {
    return this._exec();
  }
  async run() {
    return this._exec();
  }
}

export function createTestD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return {
    prepare: (sql) => new Statement(db, sql),
    // D1 ejecuta el batch como una transacción: si una sentencia falla, no se aplica ninguna.
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const out = statements.map((s) => s._exec());
        db.exec("COMMIT");
        return out;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    async exec(sql) {
      db.exec(sql);
      return { count: 1 };
    }
  };
}
