// Leitura da Steam: wishlist (IWishlistService) e preços da loja (IStoreBrowseService).
// Nenhum dos dois exige API key para perfil/loja públicos.

const API = "https://api.steampowered.com";

// EResult 15 = AccessDenied: a wishlist segue a privacidade de "Detalhes de jogos".
const ERESULT_ACCESS_DENIED = "15";

export class WishlistPrivadaError extends Error {
  constructor(steamId: string) {
    super(
      `A Steam negou acesso à wishlist de ${steamId}. Em Steam > Perfil > Editar perfil > ` +
        `Privacidade, deixe "Detalhes de jogos" como Público.`,
    );
  }
}

export interface WishlistItem {
  appid: number;
  priority: number;
  addedAt: Date;
}

export async function getWishlist(steamId: string): Promise<WishlistItem[]> {
  const res = await fetch(`${API}/IWishlistService/GetWishlist/v1/?steamid=${steamId}`);
  if (res.headers.get("x-eresult") === ERESULT_ACCESS_DENIED) throw new WishlistPrivadaError(steamId);
  if (!res.ok) throw new Error(`GetWishlist respondeu ${res.status}`);

  const body = (await res.json()) as {
    response: { items?: { appid: number; priority: number; date_added: number }[] };
  };
  return (body.response.items ?? []).map((i) => ({
    appid: i.appid,
    priority: i.priority,
    addedAt: new Date(i.date_added * 1000),
  }));
}

export interface StorePrice {
  appid: number;
  name: string;
  /** Preço atual em centavos; null quando não está à venda (gratuito, não lançado, removido). */
  finalCents: number | null;
  originalCents: number | null;
  discountPct: number;
  discountEndsAt: Date | null;
  reviewPct: number | null;
  reviewLabel: string | null;
  url: string;
}

interface RawStoreItem {
  appid?: number;
  id: number;
  success: number;
  name?: string;
  store_url_path?: string;
  reviews?: { summary_filtered?: { review_count: number; percent_positive: number; review_score_label: string } };
  best_purchase_option?: {
    final_price_in_cents?: string;
    original_price_in_cents?: string;
    discount_pct?: number;
    active_discounts?: { discount_end_date?: number }[];
  };
}

const LOTE = 50;

export async function getStorePrices(appids: number[], country: string): Promise<StorePrice[]> {
  const result: StorePrice[] = [];
  for (let i = 0; i < appids.length; i += LOTE) {
    const lote = appids.slice(i, i + LOTE);
    const input = {
      ids: lote.map((appid) => ({ appid })),
      context: { language: "brazilian", country_code: country },
      data_request: { include_basic_info: false, include_reviews: true },
    };
    const url = `${API}/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GetItems respondeu ${res.status}`);

    const body = (await res.json()) as { response: { store_items?: RawStoreItem[] } };
    for (const item of body.response.store_items ?? []) {
      if (item.success !== 1) continue;
      result.push(toStorePrice(item));
    }
  }
  return result;
}

function toStorePrice(item: RawStoreItem): StorePrice {
  const opt = item.best_purchase_option;
  const final = opt?.final_price_in_cents ? Number(opt.final_price_in_cents) : null;
  const original = opt?.original_price_in_cents ? Number(opt.original_price_in_cents) : final;
  const endsAt = opt?.active_discounts?.find((d) => d.discount_end_date)?.discount_end_date;
  // Jogo sem nenhuma análise (ex.: ainda não lançado) vem com 0%: tratar como "sem nota".
  const reviews = item.reviews?.summary_filtered?.review_count ? item.reviews.summary_filtered : undefined;
  return {
    appid: item.appid ?? item.id,
    name: item.name ?? `app ${item.id}`,
    finalCents: final,
    originalCents: original,
    discountPct: opt?.discount_pct ?? 0,
    discountEndsAt: endsAt ? new Date(endsAt * 1000) : null,
    reviewPct: reviews?.percent_positive ?? null,
    reviewLabel: reviews?.review_score_label ?? null,
    url: `https://store.steampowered.com/${item.store_url_path ?? `app/${item.id}`}`,
  };
}
