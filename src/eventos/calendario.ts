// Lê o calendário de promoções (config/eventos-steam.json). Arquivo inválido derruba o bot na
// inicialização com a mensagem do problema; arquivo ausente apenas desliga os avisos de evento.

import { existsSync, readFileSync } from "node:fs";
import type { EventoSteam } from "../domain/evento.ts";

interface EventoBruto {
  id?: unknown;
  nome?: unknown;
  inicio?: unknown;
  fim?: unknown;
}

export function carregarCalendario(caminho: string): EventoSteam[] {
  if (!existsSync(caminho)) return [];
  const json = JSON.parse(readFileSync(caminho, "utf8")) as { eventos?: EventoBruto[] };
  return (json.eventos ?? []).map((e, i) => validar(e, `${caminho}, evento ${i + 1}`));
}

export function validar(e: EventoBruto, onde: string): EventoSteam {
  if (typeof e.id !== "string" || !e.id) throw new Error(`${onde}: "id" é obrigatório.`);
  if (typeof e.nome !== "string" || !e.nome) throw new Error(`${onde}: "nome" é obrigatório.`);
  const inicio = new Date(String(e.inicio));
  const fim = new Date(String(e.fim));
  if (Number.isNaN(inicio.getTime())) throw new Error(`${onde}: "inicio" não é uma data válida.`);
  if (Number.isNaN(fim.getTime())) throw new Error(`${onde}: "fim" não é uma data válida.`);
  if (fim <= inicio) throw new Error(`${onde}: "fim" precisa ser depois de "inicio".`);
  return { id: e.id, nome: e.nome, inicio, fim };
}
