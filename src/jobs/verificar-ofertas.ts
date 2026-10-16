// Um ciclo do bot: wishlist → preços → menor preço → fila de alertas → avisos de evento → envio.
// As fontes e o canal entram por parâmetro, para o ciclo inteiro ser testado sem rede.

import type { Db } from "../db/database.ts";
import * as repo from "../db/repositorio.ts";
import type { Alerta, Notifier } from "../domain/alerta.ts";
import type { Regras } from "../domain/deal-evaluator.ts";
import { eventoDaVez, type EventoSteam } from "../domain/evento.ts";
import { mensagemEvento, mensagemOfertas } from "../domain/mensagens.ts";
import { mensagemDeErro, type Log } from "../lib/log.ts";
import type { HistoricalLow } from "../providers/itad/itad-client.ts";
import type { StorePrice, WishlistItem } from "../providers/steam/steam-client.ts";
import { montarOfertas } from "./ofertas.ts";

/** Depois de tantas falhas de envio, o alerta é abandonado (status 'falhou'). */
const MAX_TENTATIVAS = 5;

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
  /** Calendário de promoções da Steam (Winter Sale, Summer Sale...). */
  eventos: EventoSteam[];
  /** Acima deste número de ofertas numa mensagem, elas vão numa lista compacta em vez de cards. */
  resumoAcimaDe: number;
  log: Log;
  agora?: () => Date;
}

export interface Resumo {
  jogos: number;
  precosMudaram: number;
  alertasNovos: number;
  enviados: number;
  itad: "ok" | "cache" | "desligado";
  /** Fase de evento avisada neste ciclo, ex.: "winter-2026:inicio". */
  evento: string | null;
}

export async function verificarOfertas(d: Dependencias): Promise<Resumo> {
  const agora = (d.agora ?? (() => new Date()))();

  const wishlist = await d.steam.getWishlist(d.steamId);
  repo.salvarWishlist(d.db, d.steamId, wishlist, agora);
  const appids = wishlist.map((w) => w.appid);

  const precos = appids.length ? await d.steam.getStorePrices(appids, d.country) : [];
  const precosMudaram = repo.registrarPrecos(d.db, precos, agora);

  const { menores, itad } = await buscarMenores(d, appids, agora);

  const ofertas = montarOfertas(precos, menores, d.regras);
  let alertasNovos = 0;
  for (const { alerta } of ofertas) {
    if (alerta && repo.enfileirar(d.db, d.destino, alerta, agora)) alertasNovos++;
  }

  const contexto = {
    alertasAtuais: ofertas.flatMap((o) => (o.alerta ? [o.alerta] : [])),
    emPromocao: precos.filter((p) => p.discountPct > 0).length,
  };
  const { enviados, evento } = await despachar(d, agora, contexto);
  return { jogos: appids.length, precosMudaram, alertasNovos, enviados, itad, evento };
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

/**
 * Envia o aviso de evento devido (se houver) e as ofertas pendentes, incluindo as que falharam antes.
 * No início de um evento, as ofertas novas vão dentro do próprio aviso, numa mensagem só.
 */
async function despachar(
  d: Dependencias,
  agora: Date,
  ctx: { alertasAtuais: Alerta[]; emPromocao: number },
): Promise<{ enviados: number; evento: string | null }> {
  let fila = repo.pendentes(d.db, d.destino);
  let enviados = 0;
  let evento: string | null = null;

  const daVez = eventoDaVez(d.eventos, agora);
  if (daVez && !repo.faseJaAvisada(d.db, d.destino, daVez.evento.id, daVez.fase)) {
    const { fase } = daVez;
    const incluidas = fase === "lembrete" ? [] : fila;
    const alertas =
      fase === "ultimo_dia" ? unirPorJogo(ctx.alertasAtuais, fila.map((p) => p.alerta)) : incluidas.map((p) => p.alerta);
    const ids = incluidas.map((p) => p.id);

    // Último dia sem nada que valha a pena: não há o que lembrar.
    if (fase === "ultimo_dia" && alertas.length === 0) {
      repo.registrarFaseAvisada(d.db, d.destino, daVez.evento.id, fase, agora);
    } else {
      try {
        await d.notifier.enviar(mensagemEvento(daVez.evento, fase, alertas, ctx.emPromocao, d.resumoAcimaDe));
        repo.registrarFaseAvisada(d.db, d.destino, daVez.evento.id, fase, agora);
        repo.marcarEnviadas(d.db, ids, agora);
        enviados += ids.length;
        evento = `${daVez.evento.id}:${fase}`;
        fila = fila.filter((p) => !ids.includes(p.id));
      } catch (err) {
        repo.marcarFalha(d.db, ids, mensagemDeErro(err), MAX_TENTATIVAS);
        d.log.error(`Falha ao avisar ${daVez.evento.nome} (${fase}); nova tentativa no próximo ciclo: ${mensagemDeErro(err)}`);
        return { enviados, evento };
      }
    }
  }

  if (fila.length > 0) {
    const ids = fila.map((p) => p.id);
    try {
      await d.notifier.enviar(mensagemOfertas(fila.map((p) => p.alerta), d.resumoAcimaDe));
      repo.marcarEnviadas(d.db, ids, agora);
      enviados += ids.length;
    } catch (err) {
      repo.marcarFalha(d.db, ids, mensagemDeErro(err), MAX_TENTATIVAS);
      d.log.error(`Falha ao enviar ${ids.length} alerta(s); nova tentativa no próximo ciclo: ${mensagemDeErro(err)}`);
    }
  }
  return { enviados, evento };
}

/** Junta duas listas de alertas sem repetir jogo; a primeira tem preferência (preço mais recente). */
function unirPorJogo(principal: Alerta[], extra: Alerta[]): Alerta[] {
  const vistos = new Set(principal.map((a) => a.appid));
  return [...principal, ...extra.filter((a) => !vistos.has(a.appid))];
}

/** Roda um ciclo registrando a execução no banco. Nunca lança: erro vira log e execução com ok = 0. */
export async function executarCiclo(d: Dependencias): Promise<boolean> {
  const agora = d.agora ?? (() => new Date());
  const id = repo.iniciarExecucao(d.db, agora());
  try {
    const r = await verificarOfertas(d);
    const resumo =
      `${r.jogos} jogos · ${r.precosMudaram} preço(s) mudaram · ${r.alertasNovos} alerta(s) novo(s) · ` +
      `${r.enviados} enviado(s) · ITAD ${r.itad}` +
      (r.evento ? ` · evento ${r.evento}` : "");
    repo.terminarExecucao(d.db, id, true, resumo, agora());
    d.log.info(`Ciclo ok: ${resumo}`);
    return true;
  } catch (err) {
    repo.terminarExecucao(d.db, id, false, mensagemDeErro(err), agora());
    d.log.error(`Ciclo falhou: ${mensagemDeErro(err)}`);
    return false;
  }
}
