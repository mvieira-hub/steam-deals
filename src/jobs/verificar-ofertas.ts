// Um ciclo do bot, para todos os usuários:
//   wishlists (uma por pessoa) → preços e menor preço (uma consulta só, para todos os jogos)
//   → fila de alertas por pessoa → avisos de evento → envio por DM.
// As fontes e os canais entram por parâmetro, para o ciclo inteiro ser testado sem rede.

import type { Db } from "../db/database.ts";
import * as repo from "../db/repositorio.ts";
import type { Usuario } from "../db/repositorio.ts";
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
  /** Quem recebe alertas neste ciclo. */
  usuarios: () => Usuario[];
  /** O canal de cada pessoa (hoje: DM no Discord). */
  notifierPara: (u: Usuario) => Notifier;
  country: string;
  regras: Regras;
  /** Calendário de promoções da Steam (Winter Sale, Summer Sale...). */
  eventos: EventoSteam[];
  /** Acima deste número de ofertas numa mensagem, elas vão numa lista compacta em vez de cards. */
  resumoAcimaDe: number;
  /** Preços-alvo de uma pessoa (appid → centavos). Chamado a cada ciclo. */
  alvos: (destino: string) => Map<number, number>;
  /** Avisado ao fim de cada ciclo ok (monitor externo). Opcional. */
  monitor?: { ok(): Promise<void> };
  log: Log;
  agora?: () => Date;
}

export interface ResumoUsuario {
  jogos: number;
  alertasNovos: number;
  enviados: number;
  /** Fase de evento avisada neste ciclo, ex.: "winter-2026:inicio". */
  evento: string | null;
  alvos: number;
  /** Preenchido quando não deu para ler a wishlist da pessoa (ex.: ficou privada). */
  erro?: string;
}

export interface Resumo {
  usuarios: number;
  /** Jogos diferentes acompanhados, somando todas as wishlists e alvos. */
  jogos: number;
  precosMudaram: number;
  alertasNovos: number;
  enviados: number;
  itad: "ok" | "cache" | "desligado";
  /** Por discord_id. */
  porUsuario: Map<string, ResumoUsuario>;
}

interface Pessoa {
  usuario: Usuario;
  destino: string;
  wishlist: WishlistItem[];
  alvos: Map<number, number>;
  appids: Set<number>;
  erro?: string;
}

export async function verificarOfertas(d: Dependencias): Promise<Resumo> {
  const agora = (d.agora ?? (() => new Date()))();

  // 1. Wishlist de cada pessoa. Wishlist privada de um não para os outros.
  const pessoas: Pessoa[] = [];
  for (const usuario of d.usuarios()) {
    const destino = repo.destinoDe(usuario.discordId);
    const alvos = d.alvos(destino);
    let wishlist: WishlistItem[] = [];
    let erro: string | undefined;
    try {
      wishlist = await d.steam.getWishlist(usuario.steamId);
      repo.salvarWishlist(d.db, usuario.steamId, wishlist, agora);
    } catch (err) {
      erro = mensagemDeErro(err);
      d.log.warn(`Wishlist de ${usuario.nomeSteam ?? usuario.steamId} não lida: ${erro}`);
    }
    // Jogos com preço-alvo são acompanhados mesmo fora da wishlist (e mesmo se ela falhar).
    const appids = new Set([...wishlist.map((w) => w.appid), ...alvos.keys()]);
    pessoas.push({ usuario, destino, wishlist, alvos, appids, erro });
  }

  // 2. Preços e menor preço: uma consulta só, para os jogos de todo mundo.
  const todos = [...new Set(pessoas.flatMap((p) => [...p.appids]))];
  const precos = todos.length ? await d.steam.getStorePrices(todos, d.country) : [];
  const precosMudaram = repo.registrarPrecos(d.db, precos, agora);
  const { menores, itad } = await buscarMenores(d, todos, agora);
  const precoPorApp = new Map(precos.map((p) => [p.appid, p]));

  // 3. Alertas e envio, pessoa por pessoa.
  const porUsuario = new Map<string, ResumoUsuario>();
  for (const p of pessoas) {
    const meusPrecos = [...p.appids].flatMap((a) => (precoPorApp.has(a) ? [precoPorApp.get(a)!] : []));
    const ofertas = montarOfertas(meusPrecos, menores, d.regras, p.alvos);
    let alertasNovos = 0;
    for (const { alerta } of ofertas) {
      if (alerta && repo.enfileirar(d.db, p.destino, alerta, agora)) alertasNovos++;
    }
    const contexto = {
      alertasAtuais: ofertas.flatMap((o) => (o.alerta ? [o.alerta] : [])),
      emPromocao: meusPrecos.filter((x) => x.discountPct > 0).length,
    };
    const { enviados, evento } = await despachar(d, p, agora, contexto);
    porUsuario.set(p.usuario.discordId, {
      jogos: p.wishlist.length,
      alertasNovos,
      enviados,
      evento,
      alvos: p.alvos.size,
      erro: p.erro,
    });
  }

  const soma = (campo: "alertasNovos" | "enviados") => [...porUsuario.values()].reduce((s, r) => s + r[campo], 0);
  return {
    usuarios: pessoas.length,
    jogos: todos.length,
    precosMudaram,
    alertasNovos: soma("alertasNovos"),
    enviados: soma("enviados"),
    itad,
    porUsuario,
  };
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
 * Envia para uma pessoa o aviso de evento devido (se houver) e as ofertas pendentes dela,
 * incluindo as que falharam antes. No início de um evento, as ofertas novas vão dentro do aviso.
 */
async function despachar(
  d: Dependencias,
  p: Pessoa,
  agora: Date,
  ctx: { alertasAtuais: Alerta[]; emPromocao: number },
): Promise<{ enviados: number; evento: string | null }> {
  const notifier = d.notifierPara(p.usuario);
  let fila = repo.pendentes(d.db, p.destino);
  let enviados = 0;
  let evento: string | null = null;

  const daVez = eventoDaVez(d.eventos, agora);
  if (daVez && !repo.faseJaAvisada(d.db, p.destino, daVez.evento.id, daVez.fase)) {
    const { fase } = daVez;
    const incluidas = fase === "lembrete" ? [] : fila;
    const alertas =
      fase === "ultimo_dia" ? unirPorJogo(ctx.alertasAtuais, fila.map((x) => x.alerta)) : incluidas.map((x) => x.alerta);
    const ids = incluidas.map((x) => x.id);

    // Último dia sem nada que valha a pena: não há o que lembrar.
    if (fase === "ultimo_dia" && alertas.length === 0) {
      repo.registrarFaseAvisada(d.db, p.destino, daVez.evento.id, fase, agora);
    } else {
      try {
        await notifier.enviar(mensagemEvento(daVez.evento, fase, alertas, ctx.emPromocao, d.resumoAcimaDe));
        repo.registrarFaseAvisada(d.db, p.destino, daVez.evento.id, fase, agora);
        repo.marcarEnviadas(d.db, ids, agora);
        enviados += ids.length;
        evento = `${daVez.evento.id}:${fase}`;
        fila = fila.filter((x) => !ids.includes(x.id));
      } catch (err) {
        repo.marcarFalha(d.db, ids, mensagemDeErro(err), MAX_TENTATIVAS);
        d.log.error(`Falha ao avisar ${daVez.evento.nome} (${fase}) para ${p.destino}: ${mensagemDeErro(err)}`);
        return { enviados, evento };
      }
    }
  }

  if (fila.length > 0) {
    const ids = fila.map((x) => x.id);
    try {
      await notifier.enviar(mensagemOfertas(fila.map((x) => x.alerta), d.resumoAcimaDe));
      repo.marcarEnviadas(d.db, ids, agora);
      enviados += ids.length;
    } catch (err) {
      repo.marcarFalha(d.db, ids, mensagemDeErro(err), MAX_TENTATIVAS);
      d.log.error(`Falha ao enviar ${ids.length} alerta(s) para ${p.destino}; nova tentativa no próximo ciclo: ${mensagemDeErro(err)}`);
    }
  }
  return { enviados, evento };
}

/** Junta duas listas de alertas sem repetir jogo; a primeira tem preferência (preço mais recente). */
function unirPorJogo(principal: Alerta[], extra: Alerta[]): Alerta[] {
  const vistos = new Set(principal.map((a) => a.appid));
  return [...principal, ...extra.filter((a) => !vistos.has(a.appid))];
}

/** Resumo de uma pessoa em uma linha (para o log e para a resposta do /verificar). */
export function linhaDoUsuario(r: ResumoUsuario): string {
  if (r.erro) return `não consegui ler sua wishlist: ${r.erro}`;
  return (
    `${r.jogos} jogos · ${r.alertasNovos} alerta(s) novo(s) · ${r.enviados} enviado(s)` +
    (r.alvos ? ` · ${r.alvos} preço(s)-alvo` : "") +
    (r.evento ? ` · evento ${r.evento}` : "")
  );
}

export interface ResultadoCiclo {
  ok: boolean;
  resumo: string;
  porUsuario: Map<string, ResumoUsuario>;
}

/** Roda um ciclo registrando a execução no banco. Nunca lança: erro vira log e execução com ok = 0. */
export async function executarCiclo(d: Dependencias): Promise<ResultadoCiclo> {
  const agora = d.agora ?? (() => new Date());
  const id = repo.iniciarExecucao(d.db, agora());
  try {
    const r = await verificarOfertas(d);
    const resumo =
      `${r.usuarios} usuário(s) · ${r.jogos} jogos · ${r.precosMudaram} preço(s) mudaram · ` +
      `${r.alertasNovos} alerta(s) novo(s) · ${r.enviados} enviado(s) · ITAD ${r.itad}`;
    repo.terminarExecucao(d.db, id, true, resumo, agora());
    d.log.info(`Ciclo ok: ${resumo}`);
    await d.monitor?.ok();
    return { ok: true, resumo, porUsuario: r.porUsuario };
  } catch (err) {
    repo.terminarExecucao(d.db, id, false, mensagemDeErro(err), agora());
    d.log.error(`Ciclo falhou: ${mensagemDeErro(err)}`);
    return { ok: false, resumo: mensagemDeErro(err), porUsuario: new Map() };
  }
}
