// Aviso de "estou vivo" para um monitor externo (ex.: Healthchecks.io).
// O bot faz um GET nesta URL ao fim de cada ciclo ok; se os avisos pararem, o monitor manda e-mail.
// Nunca atrapalha o bot: se o monitor estiver fora do ar, só registra no log.

import { mensagemDeErro, type Log } from "./log.ts";

const TIMEOUT_MS = 10_000;

export function criarMonitor(url: string, log: Log): { ok(): Promise<void> } {
  if (!url) return { ok: async () => {} };
  return {
    async ok() {
      try {
        await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (err) {
        log.warn(`Não consegui avisar o monitor: ${mensagemDeErro(err)}`);
      }
    },
  };
}
