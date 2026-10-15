// SQLite nativo do Node 24 (node:sqlite): sem dependência e sem compilação no Alpine.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRACOES } from "./migracoes.ts";

export type Db = DatabaseSync;

/** Abre (ou cria) o banco e aplica as migrações pendentes. Use ":memory:" nos testes. */
export function abrirBanco(caminho: string): Db {
  if (caminho !== ":memory:") mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrar(db);
  return db;
}

function migrar(db: Db): void {
  const atual = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  for (let v = atual; v < MIGRACOES.length; v++) {
    transacao(db, () => {
      db.exec(MIGRACOES[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function transacao<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
