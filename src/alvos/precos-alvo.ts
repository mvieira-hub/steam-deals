// Lê o arquivo de preços-alvo (config/precos-alvo.json): appid → preço-alvo em centavos.

import { existsSync, readFileSync } from "node:fs";

interface AlvoBruto {
  jogo?: unknown;
  nome?: unknown;
  ate?: unknown;
}

/** Aceita o número do app ou o link da loja (store.steampowered.com/app/<appid>/...). */
export function extrairAppid(jogo: unknown): number | null {
  if (typeof jogo === "number" && Number.isInteger(jogo) && jogo > 0) return jogo;
  if (typeof jogo !== "string") return null;
  const texto = jogo.trim();
  if (/^\d+$/.test(texto)) return Number(texto);
  const m = texto.match(/\/app\/(\d+)/);
  return m ? Number(m[1]) : null;
}

export function carregarAlvos(caminho: string): Map<number, number> {
  if (!existsSync(caminho)) return new Map();
  const json = JSON.parse(readFileSync(caminho, "utf8")) as { alvos?: AlvoBruto[] };
  const alvos = new Map<number, number>();
  for (const [i, a] of (json.alvos ?? []).entries()) {
    const onde = `${caminho}, alvo ${i + 1}${typeof a.nome === "string" ? ` (${a.nome})` : ""}`;
    const appid = extrairAppid(a.jogo);
    if (!appid) throw new Error(`${onde}: "jogo" precisa ser o link da loja ou o número do app.`);
    if (typeof a.ate !== "number" || !(a.ate > 0)) throw new Error(`${onde}: "ate" precisa ser um valor em reais, como 49.90.`);
    alvos.set(appid, Math.round(a.ate * 100));
  }
  return alvos;
}
