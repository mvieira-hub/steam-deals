import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { abrirBanco, type Db } from "../db/database.ts";
import type { Mensagem } from "../domain/alerta.ts";
import type { EventoSteam } from "../domain/evento.ts";
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
    enviados: [] as Mensagem[],
    agora: new Date("2026-10-16T12:00:00Z"),
    eventos: [] as EventoSteam[],
    alvos: new Map<number, number>(),
    /** Jogos na wishlist; por padrão, todos os de `precos`. */
    wishlist: null as number[] | null,
  };
  const deps: Dependencias = {
    db,
    steam: {
      getWishlist: async () =>
        (estado.wishlist ?? estado.precos.map((p) => p.appid)).map((appid) => ({ appid, priority: 0, addedAt: new Date("2024-01-01") })),
      getStorePrices: async (appids) => estado.precos.filter((p) => appids.includes(p.appid)),
    },
    itad: {
      getLows: async () => {
        if (estado.itadFalha) throw new Error("ITAD fora");
        return estado.menores;
      },
    },
    usuarios: () => [{ discordId: "123", steamId: "765", nomeSteam: "Dono" }],
    notifierPara: () => ({
      enviar: async (mensagem) => {
        if (estado.discordFalha) throw new Error("Discord fora");
        estado.enviados.push(mensagem);
      },
    }),
    country: "BR",
    regras: { margemPertoPct: 10, descontoMinPct: 0, reviewMinPct: 0, referencia: "steam", semHistoricoMinPct: 50 },
    get eventos() {
      return estado.eventos;
    },
    resumoAcimaDe: 5,
    alvos: () => estado.alvos,
    log: logMudo,
    agora: () => estado.agora,
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
    assert.equal(estado.enviados[0]!.alertas[0]!.appid, 1);

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
    assert.equal(estado.enviados[1]!.alertas[0]!.finalCents, 999);
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
    deps.steam.getStorePrices = async () => {
      throw new Error("Steam fora");
    };
    const r = await executarCiclo(deps);
    assert.equal(r.ok, false);
    assert.equal(r.resumo, "Steam fora");
    const ex = db.prepare("SELECT ok, resumo FROM execucoes").get() as { ok: number; resumo: string };
    assert.equal(ex.ok, 0);
    assert.equal(ex.resumo, "Steam fora");
  });
});

describe("eventos e resumo", () => {
  let db: Db;
  beforeEach(() => (db = abrirBanco(":memory:")));

  const WINTER: EventoSteam = {
    id: "winter",
    nome: "Winter Sale",
    inicio: new Date("2026-12-17T18:00:00Z"),
    fim: new Date("2027-01-04T18:00:00Z"),
  };
  const horas = (base: Date, h: number) => new Date(base.getTime() + h * 3600_000);

  it("lembrete na véspera: avisa uma vez, separado das ofertas", async () => {
    const { estado, deps } = cenario(db);
    estado.eventos = [WINTER];
    estado.agora = horas(WINTER.inicio, -2);

    const r = await verificarOfertas(deps);
    assert.equal(r.porUsuario.get("123")!.evento, "winter:lembrete");
    assert.equal(estado.enviados.length, 2, "lembrete + mensagem da oferta");
    assert.match(estado.enviados[0]!.titulo, /Amanhã começa a Winter Sale/);
    assert.equal(estado.enviados[0]!.alertas.length, 0);

    await verificarOfertas(deps);
    assert.equal(estado.enviados.length, 2, "não repete o lembrete");
  });

  it("início: as ofertas novas vão dentro do aviso, numa mensagem só", async () => {
    const { estado, deps } = cenario(db);
    estado.eventos = [WINTER];
    estado.agora = horas(WINTER.inicio, 1);

    const r = await verificarOfertas(deps);
    assert.equal(r.porUsuario.get("123")!.evento, "winter:inicio");
    assert.equal(r.enviados, 1);
    assert.equal(estado.enviados.length, 1);
    assert.match(estado.enviados[0]!.titulo, /Começou a Winter Sale/);
    assert.equal(estado.enviados[0]!.alertas[0]!.appid, 1);

    await verificarOfertas(deps);
    assert.equal(estado.enviados.length, 1, "nem o aviso nem a oferta se repetem");
  });

  it("bot desligado na véspera: pula o lembrete e avisa o início", async () => {
    const { estado, deps } = cenario(db);
    estado.eventos = [WINTER];
    estado.agora = horas(WINTER.inicio, 30);
    assert.equal((await verificarOfertas(deps)).porUsuario.get("123")!.evento, "winter:inicio");
  });

  it("último dia: lembra o que ainda vale a pena, mesmo já avisado", async () => {
    const { estado, deps } = cenario(db);
    estado.eventos = [WINTER];
    estado.agora = horas(WINTER.inicio, 1);
    await verificarOfertas(deps);

    estado.agora = horas(WINTER.fim, -2);
    const r = await verificarOfertas(deps);
    assert.equal(r.porUsuario.get("123")!.evento, "winter:ultimo_dia");
    assert.match(estado.enviados[1]!.titulo, /Último dia da Winter Sale/);
    assert.equal(estado.enviados[1]!.alertas[0]!.appid, 1);

    await verificarOfertas(deps);
    assert.equal(estado.enviados.length, 2, "não repete o último dia");
  });

  it("último dia sem nada que valha a pena: não manda mensagem", async () => {
    const { estado, deps } = cenario(db);
    estado.eventos = [WINTER];
    estado.precos = [preco({ appid: 2, finalCents: 4999, originalCents: 4999, discountPct: 0, discountEndsAt: null })];
    estado.agora = horas(WINTER.fim, -2);
    await verificarOfertas(deps);
    assert.equal(estado.enviados.length, 0);
  });

  it("Discord fora no início do evento: tenta de novo no ciclo seguinte", async () => {
    const { estado, deps } = cenario(db);
    estado.eventos = [WINTER];
    estado.agora = horas(WINTER.inicio, 1);
    estado.discordFalha = true;
    assert.equal((await verificarOfertas(deps)).porUsuario.get("123")!.evento, null);

    estado.discordFalha = false;
    const r = await verificarOfertas(deps);
    assert.equal(r.porUsuario.get("123")!.evento, "winter:inicio");
    assert.equal(r.enviados, 1);
  });

  it("muitas ofertas de uma vez viram uma lista só", async () => {
    const { estado, deps } = cenario(db);
    estado.precos = Array.from({ length: 7 }, (_, i) => preco({ appid: 10 + i }));
    estado.menores = new Map(estado.precos.map((p) => [p.appid, menor(1499)]));
    const r = await verificarOfertas(deps);
    assert.equal(r.enviados, 7);
    assert.equal(estado.enviados.length, 1);
    assert.equal(estado.enviados[0]!.formato, "lista");
  });
});

describe("preço-alvo", () => {
  let db: Db;
  beforeEach(() => (db = abrirBanco(":memory:")));

  it("avisa jogo fora da wishlist quando chega no alvo", async () => {
    const { estado, deps } = cenario(db);
    estado.wishlist = [2];
    estado.alvos = new Map([[1, 1500]]);
    const r = await verificarOfertas(deps);
    assert.equal(r.porUsuario.get("123")!.jogos, 1, "a wishlist continua com 1 jogo");
    assert.equal(r.enviados, 1);
    const alerta = estado.enviados[0]!.alertas[0]!;
    assert.equal(alerta.appid, 1);
    assert.equal(alerta.atingiuAlvo, true);
    assert.equal(alerta.alvoCents, 1500);
  });

  it("avisa sem desconto quando o preço cheio fica abaixo do alvo", async () => {
    const { estado, deps } = cenario(db);
    estado.alvos = new Map([[2, 5000]]);
    const r = await verificarOfertas(deps);
    assert.ok(estado.enviados[0]!.alertas.some((a) => a.appid === 2 && a.atingiuAlvo));
    assert.equal(r.alertasNovos, 2, "jogo 1 pelo selo 🟢, jogo 2 pelo alvo");
  });

  it("acima do alvo segue as regras normais", async () => {
    const { estado, deps } = cenario(db);
    estado.alvos = new Map([[2, 3000]]);
    await verificarOfertas(deps);
    assert.ok(!estado.enviados[0]!.alertas.some((a) => a.appid === 2));
  });
});

describe("vários usuários", () => {
  let db: Db;
  beforeEach(() => (db = abrirBanco(":memory:")));

  /** Dois amigos com wishlists diferentes; cada um com seu próprio canal. */
  function doisUsuarios() {
    const { estado, deps } = cenario(db);
    const wishlists: Record<string, number[]> = { "765": [1], "999": [1, 2] };
    const privadas = new Set<string>();
    const consultasDePreco: number[][] = [];
    const caixa = new Map<string, Mensagem[]>([["123", []], ["456", []]]);
    deps.usuarios = () => [
      { discordId: "123", steamId: "765", nomeSteam: "Dono" },
      { discordId: "456", steamId: "999", nomeSteam: "Amigo" },
    ];
    deps.steam.getWishlist = async (steamId) => {
      if (privadas.has(steamId)) throw new Error("wishlist privada");
      return wishlists[steamId]!.map((appid) => ({ appid, priority: 0, addedAt: new Date("2024-01-01") }));
    };
    deps.steam.getStorePrices = async (appids) => {
      consultasDePreco.push([...appids].sort());
      return estado.precos.filter((p) => appids.includes(p.appid));
    };
    deps.notifierPara = (u) => ({ enviar: async (m) => void caixa.get(u.discordId)!.push(m) });
    return { estado, deps, caixa, privadas, consultasDePreco };
  }

  it("cada pessoa recebe o alerta na própria DM, com uma consulta de preços só", async () => {
    const { deps, caixa, consultasDePreco } = doisUsuarios();
    const r = await verificarOfertas(deps);
    assert.equal(r.usuarios, 2);
    assert.deepEqual(consultasDePreco, [[1, 2]], "jogos de todos numa consulta");
    assert.equal(caixa.get("123")![0]!.alertas[0]!.appid, 1);
    assert.equal(caixa.get("456")![0]!.alertas[0]!.appid, 1);
    assert.equal(r.porUsuario.get("456")!.jogos, 2);
  });

  it("não repete para ninguém, e cada um tem o próprio histórico", async () => {
    const { deps, caixa } = doisUsuarios();
    await verificarOfertas(deps);
    await verificarOfertas(deps);
    assert.equal(caixa.get("123")!.length, 1);
    assert.equal(caixa.get("456")!.length, 1);
  });

  it("wishlist privada de um não atrapalha o outro", async () => {
    const { deps, caixa, privadas } = doisUsuarios();
    privadas.add("765");
    const r = await verificarOfertas(deps);
    assert.match(r.porUsuario.get("123")!.erro!, /privada/);
    assert.equal(caixa.get("123")!.length, 0);
    assert.equal(caixa.get("456")!.length, 1);
  });

  it("preço-alvo vale só para quem definiu", async () => {
    const { estado, deps, caixa } = doisUsuarios();
    deps.alvos = (destino) => (destino === "discord:456" ? new Map([[2, 5000]]) : new Map());
    await verificarOfertas(deps);
    assert.ok(caixa.get("456")![0]!.alertas.some((a) => a.appid === 2 && a.atingiuAlvo));
    assert.ok(!caixa.get("123")![0]!.alertas.some((a) => a.appid === 2));
    void estado;
  });

  it("sem ninguém cadastrado, não consulta nada", async () => {
    const { deps, consultasDePreco } = doisUsuarios();
    deps.usuarios = () => [];
    const r = await verificarOfertas(deps);
    assert.equal(r.usuarios, 0);
    assert.equal(consultasDePreco.length, 0);
  });
});
