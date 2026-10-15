// Regra pura (sem rede, sem banco): o quanto uma oferta vale a pena e se merece alerta.

export type Selo = "MENOR_PRECO" | "PERTO_DO_MENOR" | "FALSA_OFERTA" | "SEM_HISTORICO" | "SEM_DESCONTO" | "INDISPONIVEL";

export const SELO_LABEL: Record<Selo, string> = {
  MENOR_PRECO: "🟢 menor preço",
  PERTO_DO_MENOR: "🟡 perto do menor",
  FALSA_OFERTA: "🔴 longe do menor",
  SEM_HISTORICO: "⚪ sem histórico",
  SEM_DESCONTO: "· sem desconto",
  INDISPONIVEL: "· indisponível",
};

export interface Regras {
  /** Até quantos % acima do menor histórico ainda é 🟡. */
  margemPertoPct: number;
  /** Desconto mínimo para alertar, mesmo com selo 🟢/🟡. 0 = o selo decide sozinho. */
  descontoMinPct: number;
  /** Nota mínima de reviews (% positivas). 0 = sem filtro. Jogo sem análises sempre passa. */
  reviewMinPct: number;
  /** Menor preço de referência: só o da Steam ou o de qualquer loja (mais rigoroso). */
  referencia: "steam" | "qualquer";
  /** Jogo sem histórico no ITAD só alerta com desconto a partir deste valor. */
  semHistoricoMinPct: number;
}

export interface Oferta {
  finalCents: number | null;
  discountPct: number;
  reviewPct: number | null;
  steamLowCents: number | null;
  anyStoreLowCents: number | null;
}

export interface Avaliacao {
  selo: Selo;
  alertar: boolean;
  /** Por que não alerta, quando o selo sozinho alertaria (filtro de desconto ou nota). */
  barradoPor?: string;
}

export function avaliar(o: Oferta, r: Regras): Avaliacao {
  const selo = calcularSelo(o, r);
  const candidato =
    selo === "MENOR_PRECO" ||
    selo === "PERTO_DO_MENOR" ||
    (selo === "SEM_HISTORICO" && o.discountPct >= r.semHistoricoMinPct);
  if (!candidato) return { selo, alertar: false };

  if (o.discountPct < r.descontoMinPct) {
    return { selo, alertar: false, barradoPor: `desconto ${o.discountPct}% < ${r.descontoMinPct}%` };
  }
  if (r.reviewMinPct > 0 && o.reviewPct !== null && o.reviewPct < r.reviewMinPct) {
    return { selo, alertar: false, barradoPor: `nota ${o.reviewPct}% < ${r.reviewMinPct}%` };
  }
  return { selo, alertar: true };
}

function calcularSelo(o: Oferta, r: Regras): Selo {
  if (o.finalCents === null) return "INDISPONIVEL";
  // Sem desconto não é oferta, mesmo que o preço cheio seja o menor (jogo que nunca entrou em promoção).
  if (o.discountPct === 0) return "SEM_DESCONTO";

  const low = referencia(o, r);
  if (low === null) return "SEM_HISTORICO";
  if (o.finalCents <= low) return "MENOR_PRECO";
  return o.finalCents <= low * (1 + r.margemPertoPct / 100) ? "PERTO_DO_MENOR" : "FALSA_OFERTA";
}

function referencia(o: Oferta, r: Regras): number | null {
  if (r.referencia === "steam" || o.anyStoreLowCents === null) return o.steamLowCents;
  if (o.steamLowCents === null) return o.anyStoreLowCents;
  return Math.min(o.steamLowCents, o.anyStoreLowCents);
}
