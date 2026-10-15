// Agendador dentro do próprio processo: sem cron, sem dependência.
// O intervalo é contado da última execução que deu certo (gravada no banco), então
// depois de o PC ficar desligado o bot recupera na hora em vez de esperar o intervalo inteiro.

import type { Log } from "./lib/log.ts";

/** Depois de uma falha, tenta de novo neste prazo (ou no intervalo, se for menor). */
export const ESPERA_APOS_FALHA_MS = 15 * 60 * 1000;

/** Quanto esperar até a próxima execução. 0 = rodar agora. */
export function esperaAteProxima(ultimaOk: Date | null, agora: Date, intervaloMs: number): number {
  if (!ultimaOk) return 0;
  return Math.max(0, ultimaOk.getTime() + intervaloMs - agora.getTime());
}

export interface Agendador {
  parar(): void;
}

export function iniciarAgendador(opts: {
  ciclo: () => Promise<boolean>;
  ultimaOk: () => Date | null;
  intervaloMs: number;
  log: Log;
}): Agendador {
  let timer: NodeJS.Timeout | undefined;
  let parado = false;

  const agendar = (esperaMs: number) => {
    if (parado) return;
    const quando = new Date(Date.now() + esperaMs).toLocaleString("pt-BR", { timeZone: process.env.TZ || "America/Sao_Paulo" });
    opts.log.info(esperaMs === 0 ? "Rodando agora." : `Próxima verificação: ${quando}.`);
    timer = setTimeout(rodar, esperaMs);
  };

  const rodar = async () => {
    const ok = await opts.ciclo();
    agendar(ok ? opts.intervaloMs : Math.min(ESPERA_APOS_FALHA_MS, opts.intervaloMs));
  };

  agendar(esperaAteProxima(opts.ultimaOk(), new Date(), opts.intervaloMs));

  return {
    parar() {
      parado = true;
      clearTimeout(timer);
    },
  };
}
