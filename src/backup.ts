// Cópia consistente do banco num arquivo só (data/steam-deals-backup.db), mesmo com o bot rodando.
// Serve para levar o histórico de alertas e os preços-alvo para outro computador ou servidor.
//   docker compose exec bot node src/backup.ts

import { existsSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";

const destino = config.bancoCaminho.replace(/\.db$/, "") + "-backup.db";
if (existsSync(destino)) rmSync(destino);

const db = new DatabaseSync(config.bancoCaminho, { readOnly: true });
db.prepare("VACUUM INTO ?").run(destino);
db.close();

console.log(`Backup salvo em ${destino}`);
