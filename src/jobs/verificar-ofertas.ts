// Um ciclo do bot: wishlist → preços → menor preço → fila de alertas → envio.
// As fontes e o canal entram por parâmetro, para o ciclo inteiro ser testado sem rede.

import type { Db } from "../db/database.ts";
import * as repo from "../db/repositorio.ts";
import type { Notifier } from "../domain/alerta.ts";
import type { Regras } from "../domain/deal-evaluator.ts";
import { mensagemDeErro, type Log } from "../lib/log.ts";
import type { HistoricalLow } from "../providers/itad/itad-client.ts";
import type { StorePrice, WishlistItem } from "../providers/steam/steam-client.ts";
import { montarOfertas } from "./ofertas.ts";

/** Depois de tantas falhas de envio, o alerta é abandonado (status 'falhou'). */
const MAX_TENTATIVAS = 5;
/** Limite de embeds por mensagem do Discord: cada lote é marcado como enviado separadamente. */
const ALERTAS_POR_LOTE = 10;

export interface Dependencias {
  db: Db;
  steam: {
    getWishlist(steamId: string): Promise<WishlistItem[]>;
    getStorePrices(appids: number[], country: string): Promise<StorePrice[]>;
  };
  /** null quando não há chave do ITAD: o bot funciona, mas sem menor preço histórico. */
  itad: { getLows(appids: number[]): Promise<Map<number, HistoricalLow>> } | null;
  notifier: Notifier;
  /** Para quem vai o alerta (hoje: o ID de usuário do Discord). */
  destino: string;
  steamId: string;
  country: string;
  regras: Regras;
  log: Log;
  agora?: () => Date;
}

export interface Resumo {
  jogos: number;
  precosMudaram: number;
  alertasNovos: number;
  enviados: number;
  itad: "ok" | "cache" | "desligado";
}

export async function verificarOfertas(d: Dependencias): Promise<Resumo> {
  const agora = (d.agora ?? (() => new Date()))();

  const wishlist = await d.steam.getWishlist(d.steamId);
  repo.salvarWishlist(d.db, d.steamId, wishlist, agora);
  const appids = wishlist.map((w) => w.appid);

  const precos = appids.length ? await d.steam.getStorePrices(appids, d.country) : [];
  const precosMudaram = repo.registrarPrecos(d.db, precos, agora);

  const { menores, itad } = await buscarMenores(d, appids, agora);

  let alertasNovos = 0;
  for (const { alerta } of montarOfertas(precos, menores, d.regras)) {
    if (alerta && repo.enfileirar(d.db, d.destino, alerta, agora)) alertasNovos++;
  }

  const enviados = await despacharPendentes(d, agora);
  return { jogos: appids.length, precosMudaram, alertasNovos, enviados, itad };
}

/** ITAD fora do ar não pode parar o bot: usa o último menor preço salvo no banco. */
async function buscarMenores(d: Dependencias, appids: number[], agora: Date) {
  if (!d.itad || appids.length === 0) {
    return { menores: repo.lerMenores(d.db, appids), itad: "desligado" as const };
  }
  try {
    const menores = await d.itad.getLows(appids);
    repo.salvarMenores(d.db, menores, agora);
    return { menores, itad: "ok" as const };
  } catch (err) {
    d.log.warn(`ITAD indisponível, usando menor preço salvo: ${mensagemDeErro(err)}`);
    return { menores: repo.lerMenores(d.db, appids), itad: "cache" as const };
  }
}

/** Envia o que estiver pendente, incluindo o que falhou em ciclos anteriores. */
async function despacharPendentes(d: Dependencias, agora: Date): Promise<number> {
  const fila = repo.pendentes(d.db, d.destino);
  let enviados = 0;
  for (let i = 0; i < fila.length; i += ALERTAS_POR_LOTE) {
    const lote = fila.slice(i, i + ALERTAS_POR_LOTE);
    const ids = lote.map((p) => p.id);
    try {
      await d.notifier.enviar(lote.map((p) => p.alerta));
      repo.marcarEnviadas(d.db, ids, agora);
      enviados += lote.length;
    } catch (err) {
      repo.marcarFalha(d.db, ids, mensagemDeErro(err), MAX_TENTATIVAS);
      d.log.error(`Falha ao enviar ${lote.length} alerta(s); nova tentativa no próximo ciclo: ${mensagemDeErro(err)}`);
      break; // canal com problema: não adianta tentar os outros lotes agora
    }
  }
  return enviados;
}

/** Roda um ciclo registrando a execução no banco. Nunca lança: erro vira log e execução com ok = 0. */
export async function executarCiclo(d: Dependencias): Promise<boolean> {
  const agora = d.agora ?? (() => new Date());
  const id = repo.iniciarExecucao(d.db, agora());
  try {
    const r = await verificarOfertas(d);
    const resumo =
      `${r.jogos} jogos · ${r.precosMudaram} preço(s) mudaram · ${r.alertasNovos} alerta(s) novo(s) · ` +
      `${r.enviados} enviado(s) · ITAD ${r.itad}`;
    repo.terminarExecucao(d.db, id, true, resumo, agora());
    d.log.info(`Ciclo ok: ${resumo}`);
    return true;
  } catch (err) {
    repo.terminarExecucao(d.db, id, false, mensagemDeErro(err), agora());
    d.log.error(`Ciclo falhou: ${mensagemDeErro(err)}`);
    return false;
  }
}
