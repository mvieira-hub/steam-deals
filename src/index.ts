// O bot. Sem argumentos: fica rodando e verifica a cada INTERVALO_HORAS.
// Com --uma-vez: roda um ciclo e sai (útil para testar ou para um cron externo).

import { config } from "./config.ts";
import { abrirBanco } from "./db/database.ts";
import { ultimaExecucaoOk } from "./db/repositorio.ts";
import { carregarCalendario } from "./eventos/calendario.ts";
import { executarCiclo, type Dependencias } from "./jobs/verificar-ofertas.ts";
import { log } from "./lib/log.ts";
import { DiscordDmNotifier } from "./notifiers/discord/discord-dm.ts";
import { ItadClient } from "./providers/itad/itad-client.ts";
import { getStorePrices, getWishlist } from "./providers/steam/steam-client.ts";
import { iniciarAgendador } from "./scheduler.ts";

if (!config.discordBotToken || !config.discordUserId) {
  log.error("Preencha DISCORD_BOT_TOKEN e DISCORD_USER_ID no .env.");
  process.exit(1);
}
if (!config.itadApiKey) log.warn("Sem ITAD_API_KEY: alertas sem menor preço histórico.");

const db = abrirBanco(config.bancoCaminho);

const eventos = carregarCalendario(config.calendarioCaminho);
const proximo = eventos.filter((e) => e.fim > new Date()).sort((a, b) => +a.inicio - +b.inicio)[0];
if (proximo) {
  log.info(`Próximo evento no calendário: ${proximo.nome} (${proximo.inicio.toLocaleDateString("pt-BR")}).`);
} else {
  log.warn(`Calendário sem eventos futuros: atualize ${config.calendarioCaminho} para receber avisos de promoções.`);
}

const deps: Dependencias = {
  db,
  steam: { getWishlist, getStorePrices },
  itad: config.itadApiKey ? new ItadClient(config.itadApiKey, config.country) : null,
  notifier: new DiscordDmNotifier(config.discordBotToken, config.discordUserId),
  destino: `discord:${config.discordUserId}`,
  steamId: config.steamId,
  country: config.country,
  regras: config.regras,
  eventos,
  resumoAcimaDe: config.resumoAcimaDe,
  log,
};

if (process.argv.includes("--uma-vez")) {
  const ok = await executarCiclo(deps);
  db.close();
  process.exit(ok ? 0 : 1);
}

log.info(`Steam Deals no ar: verificando a cada ${config.intervaloHoras}h.`);
const agendador = iniciarAgendador({
  ciclo: () => executarCiclo(deps),
  ultimaOk: () => ultimaExecucaoOk(db),
  intervaloMs: config.intervaloHoras * 60 * 60 * 1000,
  log,
});

// `docker stop` manda SIGTERM: fechar o banco e sair na hora, em vez de ser morto 10s depois.
for (const sinal of ["SIGTERM", "SIGINT"] as const) {
  process.on(sinal, () => {
    log.info(`${sinal} recebido, encerrando.`);
    agendador.parar();
    db.close();
    process.exit(0);
  });
}
