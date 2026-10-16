// Diagnóstico: mostra em tabela o que o bot veria agora, sem gravar nada.
// Com --enviar, manda os alertas por DM (ignora o banco: pode repetir). O bot de verdade é o src/index.ts.

import { config } from "./config.ts";
import { SELO_LABEL } from "./domain/deal-evaluator.ts";
import { mensagemOfertas } from "./domain/mensagens.ts";
import { montarOfertas } from "./jobs/ofertas.ts";
import { brl } from "./lib/format.ts";
import { DiscordDmNotifier } from "./notifiers/discord/discord-dm.ts";
import { ItadClient, type HistoricalLow } from "./providers/itad/itad-client.ts";
import { getStorePrices, getWishlist, WishlistPrivadaError } from "./providers/steam/steam-client.ts";

// Usados quando a wishlist está privada: Elden Ring, Stardew Valley, Baldur's Gate 3, Hades II, Hollow Knight.
const APPIDS_EXEMPLO = "1245620,413150,1086940,1145350,367520";
const ENVIAR = process.argv.includes("--enviar");

async function appidsParaTestar(): Promise<number[]> {
  try {
    const wishlist = await getWishlist(config.steamId);
    console.log(`Wishlist de ${config.steamId}: ${wishlist.length} jogos.`);
    return wishlist.map((w) => w.appid);
  } catch (err) {
    if (!(err instanceof WishlistPrivadaError)) throw err;
    console.warn(`⚠️  ${err.message}`);
    const fallback = process.env.APPIDS || APPIDS_EXEMPLO;
    console.warn(`   Seguindo com appids de exemplo: ${fallback}\n`);
    return fallback.split(",").map(Number);
  }
}

async function main() {
  const r = config.regras;
  console.log(
    `Regras: 🟡 até +${r.margemPertoPct}% · desconto mín. ${r.descontoMinPct}% · nota mín. ${r.reviewMinPct || "—"}% · ` +
      `referência ${r.referencia} · sem histórico só com -${r.semHistoricoMinPct}%+\n`,
  );

  const appids = await appidsParaTestar();
  if (appids.length === 0) return console.log("Wishlist vazia.");

  const precos = await getStorePrices(appids, config.country);
  let menores = new Map<number, HistoricalLow>();
  if (config.itadApiKey) {
    menores = await new ItadClient(config.itadApiKey, config.country).getLows(appids);
  } else {
    console.warn("⚠️  Sem ITAD_API_KEY: menor preço histórico desligado.\n");
  }

  const ofertas = montarOfertas(precos, menores, r);
  console.table(
    ofertas
      .map(({ preco: p, menor, avaliacao }) => ({
        jogo: p.name.slice(0, 32),
        preço: brl(p.finalCents),
        desc: p.discountPct ? `-${p.discountPct}%` : "",
        "menor Steam": brl(menor?.steamLowCents ?? null),
        "menor outra loja": menor?.anyStoreLowCents != null ? `${brl(menor.anyStoreLowCents)} ${menor.anyStoreName}` : "—",
        reviews: p.reviewPct != null ? `${p.reviewPct}%` : "—",
        "termina em": p.discountEndsAt?.toLocaleDateString("pt-BR") ?? "",
        selo: SELO_LABEL[avaliacao.selo],
        alerta: avaliacao.alertar ? "🔔" : (avaliacao.barradoPor ?? ""),
      }))
      .sort((a, b) => a.selo.localeCompare(b.selo)),
  );

  const alertas = ofertas.flatMap((o) => (o.alerta ? [o.alerta] : []));
  if (!ENVIAR) return console.log(`\n${alertas.length} alerta(s). Rode com --enviar para mandar por DM.`);
  if (!config.discordBotToken || !config.discordUserId) {
    throw new Error("Para --enviar, preencha DISCORD_BOT_TOKEN e DISCORD_USER_ID no .env.");
  }
  await new DiscordDmNotifier(config.discordBotToken, config.discordUserId).enviar(
    mensagemOfertas(alertas, config.resumoAcimaDe),
  );
  console.log(`\n✅ ${alertas.length} alerta(s) enviado(s) por DM.`);
}

main().catch((err) => {
  console.error("Falhou:", err instanceof Error ? err.message : err);
  process.exit(1);
});
