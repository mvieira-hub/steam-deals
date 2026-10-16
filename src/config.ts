// Configuração lida do ambiente (.env), validada na inicialização: valor errado
// derruba o bot na hora com mensagem clara, em vez de gerar alertas estranhos.

import type { Regras } from "./domain/deal-evaluator.ts";

function inteiro(nome: string, padrao: number, min: number, max: number): number {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto === "") return padrao;
  const valor = Number(bruto);
  if (!Number.isInteger(valor) || valor < min || valor > max) {
    throw new Error(`${nome}=${bruto} inválido: use um número inteiro de ${min} a ${max}.`);
  }
  return valor;
}

function opcao<T extends string>(nome: string, padrao: T, validas: readonly T[]): T {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto === "") return padrao;
  if (!validas.includes(bruto as T)) throw new Error(`${nome}=${bruto} inválido: use ${validas.join(" ou ")}.`);
  return bruto as T;
}

export const config = {
  steamId: process.env.STEAM_ID ?? "76561198059563647",
  country: process.env.COUNTRY ?? "BR",
  itadApiKey: process.env.ITAD_API_KEY ?? "",
  discordBotToken: process.env.DISCORD_BOT_TOKEN ?? "",
  discordUserId: process.env.DISCORD_USER_ID ?? "",
  intervaloHoras: inteiro("INTERVALO_HORAS", 2, 1, 24),
  bancoCaminho: process.env.BANCO_CAMINHO || "data/steam-deals.db",
  calendarioCaminho: process.env.CALENDARIO_CAMINHO || "config/eventos-steam.json",
  resumoAcimaDe: inteiro("RESUMO_ACIMA_DE", 5, 1, 50),
  regras: {
    margemPertoPct: inteiro("MARGEM_PERTO_PCT", 10, 0, 100),
    descontoMinPct: inteiro("DESCONTO_MIN_PCT", 0, 0, 99),
    reviewMinPct: inteiro("REVIEW_MIN_PCT", 0, 0, 100),
    referencia: opcao("REFERENCIA", "steam", ["steam", "qualquer"] as const),
    semHistoricoMinPct: inteiro("SEM_HISTORICO_MIN_PCT", 50, 0, 100),
  } satisfies Regras,
};
