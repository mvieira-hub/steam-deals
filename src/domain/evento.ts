// Eventos de promoção da Steam (Winter Sale, Summer Sale...) e quando avisar sobre cada um. Puro.

export interface EventoSteam {
  id: string;
  nome: string;
  inicio: Date;
  fim: Date;
}

/**
 * lembrete:   nas 24h antes de começar
 * inicio:     do começo (+30 min, para a Steam já ter aplicado os descontos) até 24h antes do fim
 * ultimo_dia: nas últimas 24h
 * As janelas não se sobrepõem: em cada momento há no máximo uma fase. Se o bot estava desligado
 * durante uma janela, aquela fase é pulada — não adianta lembrar de algo que já começou.
 */
export type FaseEvento = "lembrete" | "inicio" | "ultimo_dia";

const HORA = 60 * 60 * 1000;
const ANTECEDENCIA_LEMBRETE = 24 * HORA;
const ESPERA_INICIO = HORA / 2;
const JANELA_ULTIMO_DIA = 24 * HORA;

export function faseAtual(e: EventoSteam, agora: Date): FaseEvento | null {
  const t = agora.getTime();
  const ini = e.inicio.getTime();
  const fim = e.fim.getTime();
  if (t >= ini - ANTECEDENCIA_LEMBRETE && t < ini) return "lembrete";
  if (t >= fim - JANELA_ULTIMO_DIA && t < fim) return "ultimo_dia";
  if (t >= ini + ESPERA_INICIO && t < fim - JANELA_ULTIMO_DIA) return "inicio";
  return null;
}

/** O evento (e a fase) que pede aviso agora. Se houver mais de um, o que começa primeiro. */
export function eventoDaVez(eventos: EventoSteam[], agora: Date): { evento: EventoSteam; fase: FaseEvento } | null {
  for (const evento of [...eventos].sort((a, b) => a.inicio.getTime() - b.inicio.getTime())) {
    const fase = faseAtual(evento, agora);
    if (fase) return { evento, fase };
  }
  return null;
}

export function temEventoFuturo(eventos: EventoSteam[], agora: Date): boolean {
  return eventos.some((e) => e.fim.getTime() > agora.getTime());
}
