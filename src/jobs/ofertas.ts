// Junta preço da Steam + menor preço + regras numa linha por jogo. Puro: usado pelo job e pelo spike.

import type { Alerta } from "../domain/alerta.ts";
import { avaliar, type Avaliacao, type Regras } from "../domain/deal-evaluator.ts";
import type { HistoricalLow } from "../providers/itad/itad-client.ts";
import type { StorePrice } from "../providers/steam/steam-client.ts";

export interface LinhaOferta {
  preco: StorePrice;
  menor: HistoricalLow | undefined;
  avaliacao: Avaliacao;
  /** Preenchido só quando a oferta merece alerta. */
  alerta: Alerta | null;
}

export function montarOfertas(precos: StorePrice[], menores: Map<number, HistoricalLow>, regras: Regras): LinhaOferta[] {
  return precos.map((p) => {
    const menor = menores.get(p.appid);
    const avaliacao = avaliar(
      {
        finalCents: p.finalCents,
        discountPct: p.discountPct,
        reviewPct: p.reviewPct,
        steamLowCents: menor?.steamLowCents ?? null,
        anyStoreLowCents: menor?.anyStoreLowCents ?? null,
      },
      regras,
    );
    const alerta: Alerta | null =
      avaliacao.alertar && p.finalCents !== null
        ? {
            appid: p.appid,
            nome: p.name,
            url: p.url,
            selo: avaliacao.selo,
            finalCents: p.finalCents,
            originalCents: p.originalCents,
            discountPct: p.discountPct,
            terminaEm: p.discountEndsAt,
            steamLowCents: menor?.steamLowCents ?? null,
            steamLowEm: menor?.steamLowAt ?? null,
            outraLojaLowCents: menor?.anyStoreLowCents ?? null,
            outraLojaNome: menor?.anyStoreName ?? null,
            reviewPct: p.reviewPct,
            reviewLabel: p.reviewLabel,
          }
        : null;
    return { preco: p, menor, avaliacao, alerta };
  });
}
