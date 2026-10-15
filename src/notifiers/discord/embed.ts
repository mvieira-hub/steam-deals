// Formato visual do alerta no Discord (embed). Puro: não faz rede.

import type { Alerta } from "../../domain/alerta.ts";
import type { Selo } from "../../domain/deal-evaluator.ts";
import { brl, mesAno } from "../../lib/format.ts";

const COR: Partial<Record<Selo, number>> = {
  MENOR_PRECO: 0x2ecc71,
  PERTO_DO_MENOR: 0xf1c40f,
  SEM_HISTORICO: 0x95a5a6,
};

const TITULO_SELO: Partial<Record<Selo, string>> = {
  MENOR_PRECO: "🟢 Menor preço da história na Steam",
  PERTO_DO_MENOR: "🟡 Perto do menor preço da história",
  SEM_HISTORICO: "⚪ Desconto alto (sem histórico de preço)",
};

export interface DiscordEmbed {
  title: string;
  url: string;
  description: string;
  color?: number;
  fields: { name: string; value: string; inline: boolean }[];
  image: { url: string };
  footer: { text: string };
}

/** <t:...:R> o próprio Discord mostra como "em 8 dias", no idioma de quem lê. */
const tempoRelativo = (d: Date) => `<t:${Math.floor(d.getTime() / 1000)}:R>`;

export function montarEmbed(a: Alerta): DiscordEmbed {
  const precoAntigo = a.originalCents && a.originalCents > a.finalCents ? ` ~~${brl(a.originalCents)}~~` : "";
  const fields: DiscordEmbed["fields"] = [];

  if (a.steamLowCents !== null) {
    const quando = a.steamLowEm ? ` (${mesAno(a.steamLowEm)})` : "";
    fields.push({ name: "Menor na Steam", value: `${brl(a.steamLowCents)}${quando}`, inline: true });
  }
  if (a.outraLojaLowCents !== null && a.outraLojaNome && a.outraLojaNome !== "Steam") {
    fields.push({ name: "Menor em outra loja", value: `${brl(a.outraLojaLowCents)} · ${a.outraLojaNome}`, inline: true });
  }
  if (a.reviewPct !== null) {
    fields.push({ name: "Reviews", value: `${a.reviewPct}% · ${a.reviewLabel ?? ""}`.trim(), inline: true });
  }
  if (a.terminaEm) {
    fields.push({ name: "Promoção termina", value: tempoRelativo(a.terminaEm), inline: true });
  }

  return {
    title: a.nome,
    url: a.url,
    description: `${TITULO_SELO[a.selo] ?? ""}\n## ${brl(a.finalCents)}${precoAntigo}  \`-${a.discountPct}%\``,
    color: COR[a.selo],
    fields,
    image: { url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${a.appid}/header.jpg` },
    footer: { text: "Steam Deals · histórico de preços: IsThereAnyDeal" },
  };
}
