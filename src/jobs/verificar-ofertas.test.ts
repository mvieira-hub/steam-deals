import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { abrirBanco, type Db } from "../db/database.ts";
import type { Alerta } from "../domain/alerta.ts";
import { logMudo } from "../lib/log.ts";
import type { HistoricalLow } from "../providers/itad/itad-client.ts";
import type { StorePrice } from "../providers/steam/steam-client.ts";
import { executarCiclo, verificarOfertas, type Dependencias } from "./verificar-ofertas.ts";

const FIM = new Date("2026-10-23T17:00:00Z");

const preco = (p: Partial<StorePrice> & { appid: number }): StorePrice => ({
  name: `Jogo ${p.appid}`,
  finalCents: 1499,
  originalCents: 5996,
  discountPct: 75,
  discountEndsAt: FIM,
  reviewPct: 81,
  reviewLabel: "Muito positivas",
  url: `https://store.steampowered.com/app/${p.appid}`,
  ...p,
});

const menor = (cents: number): HistoricalLow => ({
  steamLowCents: cents,
  steamLowAt: new Date("2025-03-01"),
  anyStoreLowCents: cents,
  anyStoreName: "Steam",
});

/** Cenário controlável: cada teste muda preços, menores e falhas antes de rodar o ciclo. */
function cenario(db: Db) {
  const estado = {
    precos: [preco({ appid: 1 }), preco({ appid: 2, finalCents: 4999, originalCents: 4999, discountPct: 0, discountEndsAt: null })],
    menores: new Map([[1, menor(1499)], [2, menor(2499)]]),
    itadFalha: false,
    discordFalha: false,
    enviados: [] as Alerta[][],
  };
  const deps: Dependencias = {
    db,
    steam: {
      getWishlist: async () => estado.precos.map((p) => ({ appid: p.appid, priority: 0, addedAt: new Date("2024-01-01") })),
      getStorePrices: async () => estado.precos,
    },
    itad: {
      getLows: async () => {
        if (estado.itadFalha) throw new Error("ITAD fora");
        return estado.menores;
      },
    },
    notifier: {
      enviar: async (alertas) => {
        if (estado.discordFalha) throw new Error("Discord fora");
        estado.enviados.push(alertas);
      },
    },
    destino: "discord:123",
    steamId: "765",
    country: "BR",
    regras: { margemPertoPct: 10, descontoMinPct: 0, reviewMinPct: 0, referencia: "steam", semHistoricoMinPct: 50 },
    log: logMudo,
  };
  return { estado, deps };
}

describe("verificarOfertas", () => {
  let db: Db;
  beforeEach(() => (db = abrirBanco(":memory:")));

  it("envia a oferta uma vez e não repete no ciclo seguinte", async () => {
    const { estado, deps } = cenario(db);
    const r1 = await verificarOfertas(deps);
    assert.equal(r1.alertasNovos, 1);
    assert.equal(r1.enviados, 1);
    assert.equal(estado.enviados[0]![0]!.appid, 1);

    const r2 = await verificarOfertas(deps);
    assert.equal(r2.alertasNovos, 0);
    assert.equal(r2.enviados, 0);
    assert.equal(estado.enviados.length, 1);
  });

  it("alerta de novo quando o preço cai ainda mais", async () => {
    const { estado, deps } = cenario(db);
    await verificarOfertas(deps);
    estado.precos[0] = preco({ appid: 1, finalCents: 999, discountPct: 83 });
    const r = await verificarOfertas(deps);
    assert.equal(r.alertasNovos, 1);
    assert.equal(estado.enviados[1]![0]!.finalCents, 999);
  });

  it("alerta de novo numa promoção nova, mesmo com o mesmo preço", async () => {
    const { estado, deps } = cenario(db);
    await verificarOfertas(deps);
    estado.precos[0] = preco({ appid: 1, discountEndsAt: new Date("2026-12-20T17:00:00Z") });
    assert.equal((await verificarOfertas(deps)).alertasNovos, 1);
  });

  it("Discord fora: guarda o alerta e envia no ciclo seguinte", async () => {
    const { estado, deps } = cenario(db);
    estado.discordFalha = true;
    const r1 = await verificarOfertas(deps);
    assert.equal(r1.alertasNovos, 1);
    assert.equal(r1.enviados, 0);

    estado.discordFalha = false;
    const r2 = await verificarOfertas(deps);
    assert.equal(r2.alertasNovos, 0, "não é alerta novo");
    assert.equal(r2.enviados, 1, "mas o pendente é enviado");
  });

  it("ITAD fora: usa o menor preço salvo no ciclo anterior", async () => {
    const { estado, deps } = cenario(db);
    await verificarOfertas(deps);
    estado.itadFalha = true;
    estado.precos[0] = preco({ appid: 1, finalCents: 1399, discountPct: 77 });
    const r = await verificarOfertas(deps);
    assert.equal(r.itad, "cache");
    assert.equal(r.alertasNovos, 1, "1399 <= menor salvo 1499 → 🟢");
  });

  it("só grava preço quando ele muda", async () => {
    const { deps } = cenario(db);
    assert.equal((await verificarOfertas(deps)).precosMudaram, 2);
    assert.equal((await verificarOfertas(deps)).precosMudaram, 0);
  });

  it("executarCiclo registra a execução e não lança erro", async () => {
    const { deps } = cenario(db);
    deps.steam.getWishlist = async () => {
      throw new Error("Steam fora");
    };
    assert.equal(await executarCiclo(deps), false);
    const ex = db.prepare("SELECT ok, resumo FROM execucoes").get() as { ok: number; resumo: string };
    assert.equal(ex.ok, 0);
    assert.equal(ex.resumo, "Steam fora");
  });
});
