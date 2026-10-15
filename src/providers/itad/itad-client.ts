// IsThereAnyDeal API v2: menor preço histórico. Exige chave gratuita (?key=).
// Docs: https://docs.isthereanydeal.com/

const API = "https://api.isthereanydeal.com";
const SHOP_STEAM = 61;

export interface HistoricalLow {
  /** Menor preço já registrado na própria Steam, na região pedida. */
  steamLowCents: number | null;
  steamLowAt: Date | null;
  /** Menor preço em qualquer loja acompanhada pelo ITAD (Nuuvem, GMG, Fanatical...). */
  anyStoreLowCents: number | null;
  anyStoreName: string | null;
}

export class ItadClient {
  private readonly key: string;
  private readonly country: string;

  constructor(key: string, country: string) {
    this.key = key;
    this.country = country;
  }

  /** Devolve o menor preço por appid da Steam. Jogos que o ITAD não conhece ficam de fora. */
  async getLows(appids: number[]): Promise<Map<number, HistoricalLow>> {
    const idsPorApp = await this.lookupIds(appids);
    const itadIds = [...idsPorApp.values()];
    if (itadIds.length === 0) return new Map();

    const [steamLows, anyLows] = await Promise.all([this.storeLow(itadIds), this.historyLow(itadIds)]);

    const result = new Map<number, HistoricalLow>();
    for (const [appid, itadId] of idsPorApp) {
      const steam = steamLows.get(itadId);
      const any = anyLows.get(itadId);
      result.set(appid, {
        steamLowCents: steam ? toCents(steam.price.amount) : null,
        steamLowAt: steam?.timestamp ? new Date(steam.timestamp) : null,
        anyStoreLowCents: any ? toCents(any.price.amount) : null,
        anyStoreName: any?.shop.name ?? null,
      });
    }
    return result;
  }

  private async lookupIds(appids: number[]): Promise<Map<number, string>> {
    const body = await this.post<Record<string, string | null>>(
      `/lookup/id/shop/${SHOP_STEAM}/v1`,
      appids.map((a) => `app/${a}`),
    );
    const map = new Map<number, string>();
    for (const [shopId, itadId] of Object.entries(body)) {
      if (itadId) map.set(Number(shopId.replace("app/", "")), itadId);
    }
    return map;
  }

  private async storeLow(ids: string[]): Promise<Map<string, ItadLow>> {
    const body = await this.post<{ id: string; lows: ItadLow[] }[]>(
      `/games/storelow/v2?country=${this.country}&shops=${SHOP_STEAM}`,
      ids,
    );
    return new Map(body.filter((g) => g.lows.length > 0).map((g) => [g.id, g.lows[0]!]));
  }

  private async historyLow(ids: string[]): Promise<Map<string, ItadLow>> {
    const body = await this.post<{ id: string; low: ItadLow | null }[]>(
      `/games/historylow/v1?country=${this.country}`,
      ids,
    );
    return new Map(body.filter((g) => g.low).map((g) => [g.id, g.low!]));
  }

  private async post<T>(path: string, payload: unknown): Promise<T> {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`${API}${path}${sep}key=${this.key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`ITAD ${path.split("?")[0]} respondeu ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }
}

interface ItadLow {
  shop: { id: number; name: string };
  price: { amount: number; currency: string };
  timestamp?: string;
}

const toCents = (amount: number) => Math.round(amount * 100);
