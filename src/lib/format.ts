export const brl = (cents: number | null): string =>
  cents === null ? "—" : (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "mar/2025" */
export const mesAno = (d: Date): string =>
  d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(". de ", "/").replace(" de ", "/");
