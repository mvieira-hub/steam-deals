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

const SELO_ICONE: Partial<Record<Selo, string>> = { MENOR_PRECO: "🟢", PERTO_DO_MENOR: "🟡", SEM_HISTORICO: "⚪" };
/** Limite do Discord para a descrição de um embed. */
const LIMITE_DESCRICAO = 4096;

/** Muitas ofertas num bloco só: uma linha por jogo, melhores primeiro. */
export function montarLista(alertas: Alerta[]): { description: string; color: number; footer: { text: string } } {
  const ordem: Selo[] = ["MENOR_PRECO", "PERTO_DO_MENOR", "SEM_HISTORICO"];
  const peso = (a: Alerta) => (a.atingiuAlvo ? -1 : ordem.indexOf(a.selo));
  const ordenados = [...alertas].sort((a, b) => peso(a) - peso(b) || b.discountPct - a.discountPct);

  const linhas: string[] = [];
  let tamanho = 0;
  for (const [i, a] of ordenados.entries()) {
    const icone = a.atingiuAlvo ? "🎯" : (SELO_ICONE[a.selo] ?? "•");
    const linha = `${icone} [${a.nome}](${a.url}) — **${brl(a.finalCents)}**${etiquetaDesconto(a)}`;
    const resto = `\n… e mais ${ordenados.length - i}`;
    if (tamanho + linha.length + 1 + resto.length > LIMITE_DESCRICAO) {
      linhas.push(resto.trim());
      break;
    }
    linhas.push(linha);
    tamanho += linha.length + 1;
  }
  return {
    description: linhas.join("\n"),
    color: COR.MENOR_PRECO!,
    footer: { text: "🎯 seu preço-alvo · 🟢 menor preço da história · 🟡 perto dele · ⚪ sem histórico" },
  };
}

/** " `-75%`", ou nada quando o jogo não está com desconto (pode acontecer com preço-alvo). */
const etiquetaDesconto = (a: Alerta) => (a.discountPct > 0 ? ` \`-${a.discountPct}%\`` : "");

const COR_ALVO = 0x3498db;

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

  const linhaAlvo = a.atingiuAlvo && a.alvoCents != null ? `🎯 Chegou no seu preço-alvo (${brl(a.alvoCents)})` : "";
  const cabecalho = [linhaAlvo, TITULO_SELO[a.selo] ?? ""].filter(Boolean).join("\n");

  return {
    title: a.nome,
    url: a.url,
    description: `${cabecalho}\n## ${brl(a.finalCents)}${precoAntigo} ${etiquetaDesconto(a)}`,
    color: COR[a.selo] ?? (a.atingiuAlvo ? COR_ALVO : undefined),
    fields,
    image: { url: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${a.appid}/header.jpg` },
    footer: { text: "Steam Deals · histórico de preços: IsThereAnyDeal" },
  };
}
