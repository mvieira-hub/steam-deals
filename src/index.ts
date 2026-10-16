// O bot. Sem argumentos: fica rodando, verifica a cada INTERVALO_HORAS e atende /verificar e /alvo no Discord.
// Com --uma-vez: roda um ciclo e sai (útil para testar ou para um cron externo).

import { carregarAlvos } from "./alvos/precos-alvo.ts";
import { config } from "./config.ts";
import { abrirBanco } from "./db/database.ts";
import * as repo from "./db/repositorio.ts";
import { registrarComandos, tratarInteracao, type ContextoComandos } from "./discord/comandos.ts";
import { Gateway } from "./discord/gateway.ts";
import { DiscordRest } from "./discord/rest.ts";
import { carregarCalendario } from "./eventos/calendario.ts";
import { executarCiclo, type Dependencias } from "./jobs/verificar-ofertas.ts";
import { log, mensagemDeErro } from "./lib/log.ts";
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
const rest = new DiscordRest(config.discordBotToken);
const destino = `discord:${config.discordUserId}`;

const eventos = carregarCalendario(config.calendarioCaminho);
const proximo = eventos.filter((e) => e.fim > new Date()).sort((a, b) => +a.inicio - +b.inicio)[0];
if (proximo) {
  log.info(`Próximo evento no calendário: ${proximo.nome} (${proximo.inicio.toLocaleDateString("pt-BR")}).`);
} else {
  log.warn(`Calendário sem eventos futuros: atualize ${config.calendarioCaminho} para receber avisos de promoções.`);
}

// Preços-alvo: arquivo config/precos-alvo.json + os definidos pelo /alvo (estes valem mais).
// O arquivo é relido a cada ciclo; com erro, segue com a última versão válida.
let alvosDoArquivo = new Map<number, number>();
function lerAlvosDoArquivo(): Map<number, number> {
  try {
    alvosDoArquivo = carregarAlvos(config.alvosCaminho);
  } catch (err) {
    log.error(`Preços-alvo do arquivo não atualizados, usando a última versão válida: ${mensagemDeErro(err)}`);
  }
  return alvosDoArquivo;
}
function lerAlvos(): Map<number, number> {
  const alvos = new Map(lerAlvosDoArquivo());
  for (const a of repo.listarAlvos(db, destino)) alvos.set(a.appid, a.alvoCents);
  return alvos;
}

const deps: Dependencias = {
  db,
  steam: { getWishlist, getStorePrices },
  itad: config.itadApiKey ? new ItadClient(config.itadApiKey, config.country) : null,
  notifier: new DiscordDmNotifier(rest, config.discordUserId),
  destino,
  steamId: config.steamId,
  country: config.country,
  regras: config.regras,
  eventos,
  resumoAcimaDe: config.resumoAcimaDe,
  alvos: lerAlvos,
  log,
};

if (process.argv.includes("--uma-vez")) {
  const { ok } = await executarCiclo(deps);
  db.close();
  process.exit(ok ? 0 : 1);
}

// Um ciclo por vez: se o /verificar chegar durante o ciclo agendado, espera o mesmo resultado.
let cicloEmAndamento: Promise<{ ok: boolean; resumo: string }> | null = null;
function rodarCiclo() {
  cicloEmAndamento ??= executarCiclo(deps).finally(() => (cicloEmAndamento = null));
  return cicloEmAndamento;
}

log.info(`Steam Deals no ar: verificando a cada ${config.intervaloHoras}h.`);
const agendador = iniciarAgendador({
  ciclo: async () => (await rodarCiclo()).ok,
  ultimaOk: () => repo.ultimaExecucaoOk(db),
  intervaloMs: config.intervaloHoras * 60 * 60 * 1000,
  log,
});

// Comandos no Discord. Se algo falhar aqui, os alertas continuam funcionando normalmente.
let gateway: Gateway | null = null;
if (config.discordComandos) {
  try {
    const app = await rest.chamar<{ id: string }>("GET", "/applications/@me");
    await registrarComandos(rest, app.id);
    const ctx: ContextoComandos = {
      rest,
      appId: app.id,
      donoId: config.discordUserId,
      rodarCiclo,
      alvos: {
        definir: (a) => repo.definirAlvo(db, destino, a, new Date()),
        remover: (appid) => repo.removerAlvo(db, destino, appid),
        doBanco: () => repo.listarAlvos(db, destino),
        doArquivo: lerAlvosDoArquivo,
      },
      buscarPorNome: (texto) => repo.buscarJogosPorNome(db, texto),
      buscarPreco: async (appid) => {
        const [p] = await getStorePrices([appid], config.country);
        return p ? { nome: p.name, finalCents: p.finalCents } : null;
      },
      log,
    };
    const { url } = await rest.chamar<{ url: string }>("GET", "/gateway/bot");
    gateway = new Gateway({
      token: config.discordBotToken,
      url,
      log,
      aoInteragir: (i) => void tratarInteracao(i, ctx).catch((err) => log.error(`Comando: ${mensagemDeErro(err)}`)),
    });
    gateway.conectar();
  } catch (err) {
    log.warn(`Comandos do Discord desligados (os alertas seguem normais): ${mensagemDeErro(err)}`);
  }
}

// `docker stop` manda SIGTERM: fechar tudo e sair na hora, em vez de ser morto 10s depois.
for (const sinal of ["SIGTERM", "SIGINT"] as const) {
  process.on(sinal, () => {
    log.info(`${sinal} recebido, encerrando.`);
    agendador.parar();
    gateway?.parar();
    db.close();
    process.exit(0);
  });
}
