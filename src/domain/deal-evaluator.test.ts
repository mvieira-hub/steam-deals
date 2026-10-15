import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { avaliar, type Oferta, type Regras } from "./deal-evaluator.ts";

const PADRAO: Regras = {
  margemPertoPct: 10,
  descontoMinPct: 0,
  reviewMinPct: 0,
  referencia: "steam",
  semHistoricoMinPct: 50,
};

const oferta = (o: Partial<Oferta>): Oferta => ({
  finalCents: 10000,
  discountPct: 50,
  reviewPct: 90,
  steamLowCents: 10000,
  anyStoreLowCents: null,
  ...o,
});

describe("selo", () => {
  it("🟢 quando o preço atual empata ou bate o menor da Steam", () => {
    assert.equal(avaliar(oferta({ finalCents: 10000 }), PADRAO).selo, "MENOR_PRECO");
    assert.equal(avaliar(oferta({ finalCents: 9000 }), PADRAO).selo, "MENOR_PRECO");
  });

  it("🟡 até a margem acima do menor, 🔴 depois dela", () => {
    assert.equal(avaliar(oferta({ finalCents: 11000 }), PADRAO).selo, "PERTO_DO_MENOR");
    assert.equal(avaliar(oferta({ finalCents: 11001 }), PADRAO).selo, "FALSA_OFERTA");
  });

  it("sem desconto nunca é oferta, mesmo no menor preço (jogo que nunca entrou em promoção)", () => {
    const r = avaliar(oferta({ discountPct: 0 }), PADRAO);
    assert.equal(r.selo, "SEM_DESCONTO");
    assert.equal(r.alertar, false);
  });

  it("indisponível quando não há preço", () => {
    assert.equal(avaliar(oferta({ finalCents: null }), PADRAO).selo, "INDISPONIVEL");
  });

  it("referência 'qualquer' usa a loja mais barata e fica mais rigorosa", () => {
    const o = oferta({ finalCents: 10000, steamLowCents: 10000, anyStoreLowCents: 8000 });
    assert.equal(avaliar(o, PADRAO).selo, "MENOR_PRECO");
    assert.equal(avaliar(o, { ...PADRAO, referencia: "qualquer" }).selo, "FALSA_OFERTA");
  });
});

describe("alerta", () => {
  it("alerta 🟢 e 🟡, não alerta 🔴", () => {
    assert.equal(avaliar(oferta({ finalCents: 10000 }), PADRAO).alertar, true);
    assert.equal(avaliar(oferta({ finalCents: 10500 }), PADRAO).alertar, true);
    assert.equal(avaliar(oferta({ finalCents: 20000 }), PADRAO).alertar, false);
  });

  it("sem histórico só alerta a partir do desconto mínimo configurado", () => {
    const sem = { steamLowCents: null };
    assert.equal(avaliar(oferta({ ...sem, discountPct: 49 }), PADRAO).alertar, false);
    assert.equal(avaliar(oferta({ ...sem, discountPct: 50 }), PADRAO).alertar, true);
  });

  it("desconto mínimo barra 🟢 com desconto pequeno e diz o motivo", () => {
    const r = avaliar(oferta({ discountPct: 10 }), { ...PADRAO, descontoMinPct: 20 });
    assert.equal(r.alertar, false);
    assert.equal(r.barradoPor, "desconto 10% < 20%");
  });

  it("nota mínima barra jogo mal avaliado, mas deixa passar jogo sem análises", () => {
    const regras = { ...PADRAO, reviewMinPct: 70 };
    assert.equal(avaliar(oferta({ reviewPct: 58 }), regras).barradoPor, "nota 58% < 70%");
    assert.equal(avaliar(oferta({ reviewPct: null }), regras).alertar, true);
  });
});
