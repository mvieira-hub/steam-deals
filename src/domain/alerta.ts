import type { Selo } from "./deal-evaluator.ts";

/** Tudo que um canal (Discord, Telegram...) precisa para montar a mensagem de uma oferta. */
export interface Alerta {
  appid: number;
  nome: string;
  url: string;
  selo: Selo;
  finalCents: number;
  originalCents: number | null;
  discountPct: number;
  terminaEm: Date | null;
  steamLowCents: number | null;
  steamLowEm: Date | null;
  outraLojaLowCents: number | null;
  outraLojaNome: string | null;
  reviewPct: number | null;
  reviewLabel: string | null;
}

/**
 * Identidade de uma oferta, usada para não alertar duas vezes a mesma coisa.
 * Mesmo jogo + mesmo preço + mesma data de fim = mesma oferta.
 * Preço caiu mais, ou começou outra promoção (outra data de fim) = alerta novo.
 */
export function chaveAlerta(a: Pick<Alerta, "appid" | "finalCents" | "terminaEm">): string {
  const fim = a.terminaEm ? a.terminaEm.toISOString().slice(0, 10) : "sem-fim";
  return `${a.appid}:${a.finalCents}:${fim}`;
}

/** O que vai para o canal de uma vez: um título, um texto opcional e as ofertas. */
export interface Mensagem {
  titulo: string;
  texto?: string;
  alertas: Alerta[];
  /** cards: um bloco visual por jogo. lista: todos numa lista compacta (muitas ofertas de uma vez). */
  formato: "cards" | "lista";
}

/** Porta de saída: cada canal de notificação implementa esta interface. */
export interface Notifier {
  enviar(mensagem: Mensagem): Promise<void>;
}
