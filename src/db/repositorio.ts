// Todo acesso ao banco passa por aqui: o resto do código não escreve SQL.

import { chaveAlerta, type Alerta } from "../domain/alerta.ts";
import type { HistoricalLow } from "../providers/itad/itad-client.ts";
import type { StorePrice, WishlistItem } from "../providers/steam/steam-client.ts";
import { transacao, type Db } from "./database.ts";

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const data = (s: string | null) => (s ? new Date(s) : null);

// ---------- wishlist e jogos ----------

/** Grava a wishlist atual e marca como removido o que saiu dela. */
export function salvarWishlist(db: Db, steamId: string, itens: WishlistItem[], agora: Date): void {
  transacao(db, () => {
    const upsert = db.prepare(`
      INSERT INTO wishlist (steam_id, appid, prioridade, adicionado_em, removido_em) VALUES (?, ?, ?, ?, NULL)
      ON CONFLICT (steam_id, appid) DO UPDATE SET prioridade = excluded.prioridade, removido_em = NULL`);
    for (const i of itens) upsert.run(steamId, i.appid, i.priority, i.addedAt.toISOString());

    const atuais = new Set(itens.map((i) => i.appid));
    const ativos = db
      .prepare("SELECT appid FROM wishlist WHERE steam_id = ? AND removido_em IS NULL")
      .all(steamId) as { appid: number }[];
    const remover = db.prepare("UPDATE wishlist SET removido_em = ? WHERE steam_id = ? AND appid = ?");
    for (const { appid } of ativos) if (!atuais.has(appid)) remover.run(agora.toISOString(), steamId, appid);
  });
}

// ---------- preços ----------

/** Grava nome e preço de cada jogo. Preço só ganha registro novo quando muda. Devolve quantos mudaram. */
export function registrarPrecos(db: Db, precos: StorePrice[], agora: Date): number {
  return transacao(db, () => {
    const jogo = db.prepare(`
      INSERT INTO jogos (appid, nome, atualizado_em) VALUES (?, ?, ?)
      ON CONFLICT (appid) DO UPDATE SET nome = excluded.nome, atualizado_em = excluded.atualizado_em`);
    const ultimo = db.prepare(
      "SELECT final_cents, discount_pct, termina_em FROM precos WHERE appid = ? ORDER BY id DESC LIMIT 1",
    );
    const inserir = db.prepare(`
      INSERT INTO precos (appid, final_cents, original_cents, discount_pct, termina_em, capturado_em)
      VALUES (?, ?, ?, ?, ?, ?)`);

    let mudaram = 0;
    for (const p of precos) {
      jogo.run(p.appid, p.name, agora.toISOString());
      const u = ultimo.get(p.appid) as { final_cents: number | null; discount_pct: number; termina_em: string | null } | undefined;
      const terminaEm = iso(p.discountEndsAt);
      if (u && u.final_cents === p.finalCents && u.discount_pct === p.discountPct && u.termina_em === terminaEm) continue;
      inserir.run(p.appid, p.finalCents, p.originalCents, p.discountPct, terminaEm, agora.toISOString());
      mudaram++;
    }
    return mudaram;
  });
}

// ---------- menor preço (cache do ITAD) ----------

export function salvarMenores(db: Db, menores: Map<number, HistoricalLow>, agora: Date): void {
  transacao(db, () => {
    const upsert = db.prepare(`
      INSERT INTO menores (appid, steam_low_cents, steam_low_em, outra_loja_cents, outra_loja_nome, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (appid) DO UPDATE SET
        steam_low_cents = excluded.steam_low_cents, steam_low_em = excluded.steam_low_em,
        outra_loja_cents = excluded.outra_loja_cents, outra_loja_nome = excluded.outra_loja_nome,
        atualizado_em = excluded.atualizado_em`);
    for (const [appid, m] of menores) {
      upsert.run(appid, m.steamLowCents, iso(m.steamLowAt), m.anyStoreLowCents, m.anyStoreName, agora.toISOString());
    }
  });
}

export function lerMenores(db: Db, appids: number[]): Map<number, HistoricalLow> {
  const stmt = db.prepare("SELECT * FROM menores WHERE appid = ?");
  const result = new Map<number, HistoricalLow>();
  for (const appid of appids) {
    const r = stmt.get(appid) as
      | { steam_low_cents: number | null; steam_low_em: string | null; outra_loja_cents: number | null; outra_loja_nome: string | null }
      | undefined;
    if (!r) continue;
    result.set(appid, {
      steamLowCents: r.steam_low_cents,
      steamLowAt: data(r.steam_low_em),
      anyStoreLowCents: r.outra_loja_cents,
      anyStoreName: r.outra_loja_nome,
    });
  }
  return result;
}

// ---------- fila de notificações ----------

/** Põe o alerta na fila. Devolve false se essa mesma oferta já foi enfileirada antes para esse destino. */
export function enfileirar(db: Db, destino: string, alerta: Alerta, agora: Date): boolean {
  const r = db
    .prepare("INSERT OR IGNORE INTO notificacoes (destino, chave, payload, criado_em) VALUES (?, ?, ?, ?)")
    .run(destino, chaveAlerta(alerta), JSON.stringify(alerta), agora.toISOString());
  return Number(r.changes) > 0;
}

export interface Pendente {
  id: number;
  alerta: Alerta;
}

export function pendentes(db: Db, destino: string): Pendente[] {
  const linhas = db
    .prepare("SELECT id, payload FROM notificacoes WHERE destino = ? AND status = 'pendente' ORDER BY id")
    .all(destino) as { id: number; payload: string }[];
  return linhas.map((l) => ({ id: l.id, alerta: lerAlerta(l.payload) }));
}

export function marcarEnviadas(db: Db, ids: number[], agora: Date): void {
  const stmt = db.prepare(
    "UPDATE notificacoes SET status = 'enviado', enviado_em = ?, tentativas = tentativas + 1, erro = NULL WHERE id = ?",
  );
  transacao(db, () => ids.forEach((id) => stmt.run(agora.toISOString(), id)));
}

/** Registra a falha. Depois de `maxTentativas`, desiste (status 'falhou') para não travar a fila. */
export function marcarFalha(db: Db, ids: number[], erro: string, maxTentativas: number): void {
  const stmt = db.prepare(`
    UPDATE notificacoes SET tentativas = tentativas + 1, erro = ?,
      status = CASE WHEN tentativas + 1 >= ? THEN 'falhou' ELSE 'pendente' END
    WHERE id = ?`);
  transacao(db, () => ids.forEach((id) => stmt.run(erro, maxTentativas, id)));
}

function lerAlerta(payload: string): Alerta {
  const a = JSON.parse(payload) as Alerta & { terminaEm: string | null; steamLowEm: string | null };
  return { ...a, terminaEm: data(a.terminaEm), steamLowEm: data(a.steamLowEm) };
}

// ---------- execuções ----------

export function iniciarExecucao(db: Db, agora: Date): number {
  return Number(db.prepare("INSERT INTO execucoes (iniciada_em) VALUES (?)").run(agora.toISOString()).lastInsertRowid);
}

export function terminarExecucao(db: Db, id: number, ok: boolean, resumo: string, agora: Date): void {
  db.prepare("UPDATE execucoes SET terminada_em = ?, ok = ?, resumo = ? WHERE id = ?").run(
    agora.toISOString(),
    ok ? 1 : 0,
    resumo,
    id,
  );
}

/** Quando foi a última execução que terminou bem. É dela que o agendador conta o intervalo. */
export function ultimaExecucaoOk(db: Db): Date | null {
  const r = db.prepare("SELECT MAX(iniciada_em) AS em FROM execucoes WHERE ok = 1").get() as { em: string | null };
  return data(r.em);
}
