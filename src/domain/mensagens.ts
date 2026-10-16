// Monta as mensagens (texto e formato), independente do canal. Puro.

import type { Alerta, Mensagem } from "./alerta.ts";
import type { EventoSteam, FaseEvento } from "./evento.ts";

const dataCurta = (d: Date) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
const dataHora = (d: Date) =>
  d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/** Muitas ofertas de uma vez viram uma lista só, em vez de uma avalanche de cards. */
export function mensagemOfertas(alertas: Alerta[], resumoAcimaDe: number): Mensagem {
  const n = alertas.length;
  return {
    titulo: n === 1 ? "🎮 1 oferta na sua wishlist" : `🎮 ${n} ofertas na sua wishlist`,
    alertas,
    formato: n > resumoAcimaDe ? "lista" : "cards",
  };
}

/**
 * Aviso de evento. `alertas` são as ofertas que valem a pena (🟢/🟡); `emPromocao` é quantos
 * jogos da wishlist têm qualquer desconto — para dar a dimensão da promoção.
 */
export function mensagemEvento(
  evento: EventoSteam,
  fase: FaseEvento,
  alertas: Alerta[],
  emPromocao: number,
  resumoAcimaDe: number,
): Mensagem {
  const formato = alertas.length > resumoAcimaDe ? "lista" : "cards";
  switch (fase) {
    case "lembrete":
      return {
        titulo: `⏰ Amanhã começa a ${evento.nome}`,
        texto: `De ${dataHora(evento.inicio)} até ${dataCurta(evento.fim)}. Eu aviso quando começar, com o que vale a pena da sua wishlist.`,
        alertas: [],
        formato,
      };
    case "inicio":
      return {
        titulo: `🎉 Começou a ${evento.nome}`,
        texto:
          `Vai até ${dataCurta(evento.fim)}. ${emPromocao} jogo(s) da sua wishlist em promoção` +
          (alertas.length ? `; ${alertas.length} perto ou no menor preço da história:` : ", mas nenhum perto do menor preço da história."),
        alertas,
        formato,
      };
    case "ultimo_dia":
      return {
        titulo: `⌛ Último dia da ${evento.nome}`,
        texto: `Termina ${dataHora(evento.fim)}. Ainda valem a pena:`,
        alertas,
        formato,
      };
  }
}
