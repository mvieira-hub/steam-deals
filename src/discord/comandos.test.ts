import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AlvoSalvo, Usuario } from "../db/repositorio.ts";
import type { ResumoUsuario } from "../jobs/verificar-ofertas.ts";
import { logMudo } from "../lib/log.ts";
import { WishlistPrivadaError } from "../providers/steam/steam-client.ts";
import { tratarInteracao, type ContextoComandos } from "./comandos.ts";
import type { Rest } from "./rest.ts";

const DONO = "327";
const AMIGO = "555";
const RDR2 = { appid: 1174180, nome: "Red Dead Redemption 2" };

function cenario() {
  const chamadas: { metodo: string; caminho: string; corpo: any }[] = [];
  const usuarios = new Map<string, Usuario>([[DONO, { discordId: DONO, steamId: "7656100000000000", nomeSteam: "Dono" }]]);
  const alvos = new Map<string, AlvoSalvo[]>();
  const estado = {
    arquivo: new Map<number, number>(),
    jogos: [RDR2, { appid: 990080, nome: "Hogwarts Legacy" }, { appid: 1, nome: "Red Dead Online" }],
    precoHoje: 7497 as number | null,
    wishlistPrivada: false,
    limite: 30,
    resumos: new Map<string, ResumoUsuario>([
      [DONO, { jogos: 21, alertasNovos: 1, enviados: 1, evento: null, alvos: 0 }],
      [AMIGO, { jogos: 7, alertasNovos: 0, enviados: 0, evento: null, alvos: 0 }],
    ]),
    ciclo: null as null | (() => Promise<never>),
  };
  const rest: Rest = {
    chamar: async (metodo, caminho, corpo) => {
      chamadas.push({ metodo, caminho, corpo });
      return undefined as never;
    },
  };
  const lista = (destino: string) => alvos.get(destino) ?? alvos.set(destino, []).get(destino)!;
  const ctx: ContextoComandos = {
    rest,
    appId: "app",
    donoId: DONO,
    rodarCiclo: async () => {
      if (estado.ciclo) return estado.ciclo();
      return { ok: true, resumo: "2 usuário(s)", porUsuario: estado.resumos };
    },
    usuarios: {
      buscar: (id) => usuarios.get(id) ?? null,
      salvar: (u) => void usuarios.set(u.discordId, u),
      apagar: (id) => usuarios.delete(id),
      listar: () => [...usuarios.values()],
      get limite() {
        return estado.limite;
      },
    },
    resolverPerfil: async (texto) => {
      if (texto.includes("naoexiste")) throw new Error("Perfil da Steam não encontrado. Confira o link.");
      return { steamId: "76561198000000001", nome: "Amigo" };
    },
    contarWishlist: async () => {
      if (estado.wishlistPrivada) throw new WishlistPrivadaError("x");
      return 7;
    },
    alvos: {
      definir: (destino, a) => {
        const l = lista(destino);
        const i = l.findIndex((b) => b.appid === a.appid);
        if (i >= 0) l[i] = a;
        else l.push(a);
      },
      remover: (destino, appid) => {
        const l = lista(destino);
        const i = l.findIndex((b) => b.appid === appid);
        if (i < 0) return false;
        l.splice(i, 1);
        return true;
      },
      doBanco: (destino) => lista(destino),
      doArquivo: () => estado.arquivo,
    },
    buscarPorNome: (texto) => estado.jogos.filter((j) => j.nome.toLowerCase().includes(texto.toLowerCase())),
    buscarPreco: async (appid) => {
      const jogo = estado.jogos.find((j) => j.appid === appid);
      return jogo ? { nome: jogo.nome, finalCents: estado.precoHoje } : null;
    },
    log: logMudo,
  };
  /** Texto final mostrado ao usuário (a edição da resposta adiada). */
  const resposta = () => chamadas.filter((c) => c.metodo === "PATCH").at(-1)?.corpo.content as string;
  return { chamadas, usuarios, alvos, estado, ctx, resposta };
}

const comando = (name: string, options?: unknown[], autor = DONO) => ({
  id: "i1",
  token: "tok",
  type: 2,
  user: { id: autor },
  data: { name, options },
});
const opcoes = (o: Record<string, string | number>) => Object.entries(o).map(([name, value]) => ({ name, value }));
const alvo = (sub: string, o: Record<string, string | number> = {}, autor = DONO) =>
  comando("alvo", [{ type: 1, name: sub, options: opcoes(o) }], autor);

describe("cadastro", () => {
  it("quem não se cadastrou recebe a instrução do /cadastrar", async () => {
    const { ctx, resposta } = cenario();
    await tratarInteracao(comando("verificar", undefined, AMIGO), ctx);
    assert.match(resposta(), /ainda não está cadastrado.*\/cadastrar/s);
  });

  it("/cadastrar com wishlist pública cadastra e explica o bot", async () => {
    const { ctx, usuarios, resposta } = cenario();
    await tratarInteracao(comando("cadastrar", opcoes({ perfil: "https://steamcommunity.com/id/amigo" }), AMIGO), ctx);
    assert.equal(usuarios.get(AMIGO)?.steamId, "76561198000000001");
    assert.match(resposta(), /Cadastro feito: perfil \*\*Amigo\*\*, com \*\*7 jogo\(s\)\*\*/);
    assert.match(resposta(), /\/descadastrar/);
  });

  it("/cadastrar com wishlist privada não cadastra e ensina a liberar", async () => {
    const { ctx, usuarios, estado, resposta } = cenario();
    estado.wishlistPrivada = true;
    await tratarInteracao(comando("cadastrar", opcoes({ perfil: "amigo" }), AMIGO), ctx);
    assert.equal(usuarios.has(AMIGO), false);
    assert.match(resposta(), /Encontrei o perfil \*\*Amigo\*\*.*Detalhes de jogos/s);
  });

  it("/cadastrar com perfil inexistente explica o erro", async () => {
    const { ctx, resposta } = cenario();
    await tratarInteracao(comando("cadastrar", opcoes({ perfil: "naoexiste" }), AMIGO), ctx);
    assert.match(resposta(), /Perfil da Steam não encontrado/);
  });

  it("respeita o limite de pessoas, mas deixa quem já está atualizar", async () => {
    const { ctx, usuarios, estado, resposta } = cenario();
    estado.limite = 1;
    await tratarInteracao(comando("cadastrar", opcoes({ perfil: "amigo" }), AMIGO), ctx);
    assert.match(resposta(), /limite/);
    assert.equal(usuarios.has(AMIGO), false);

    await tratarInteracao(comando("cadastrar", opcoes({ perfil: "outro" }), DONO), ctx);
    assert.match(resposta(), /Cadastro atualizado/);
  });

  it("/descadastrar apaga a pessoa", async () => {
    const { ctx, usuarios, resposta } = cenario();
    usuarios.set(AMIGO, { discordId: AMIGO, steamId: "1", nomeSteam: "Amigo" });
    await tratarInteracao(comando("descadastrar", undefined, AMIGO), ctx);
    assert.equal(usuarios.has(AMIGO), false);
    assert.match(resposta(), /dados foram apagados/);
  });

  it("/usuarios só para o dono", async () => {
    const { ctx, usuarios, resposta } = cenario();
    usuarios.set(AMIGO, { discordId: AMIGO, steamId: "1", nomeSteam: "Amigo" });
    await tratarInteracao(comando("usuarios", undefined, AMIGO), ctx);
    assert.match(resposta(), /só para o dono/);
    await tratarInteracao(comando("usuarios"), ctx);
    assert.match(resposta(), /\*\*2 usuário\(s\)\*\*[\s\S]*<@555> — Steam: \*\*Amigo\*\*/);
  });
});

describe("comandos por usuário", () => {
  it("/verificar responde 'pensando' e depois o resumo de quem pediu", async () => {
    const { ctx, chamadas, usuarios, resposta } = cenario();
    usuarios.set(AMIGO, { discordId: AMIGO, steamId: "1", nomeSteam: "Amigo" });
    await tratarInteracao(comando("verificar", undefined, AMIGO), ctx);
    assert.deepEqual(chamadas[0]!.corpo, { type: 5 });
    assert.equal(chamadas[0]!.caminho, "/interactions/i1/tok/callback");
    assert.equal(chamadas[1]!.caminho, "/webhooks/app/tok/messages/@original");
    assert.match(resposta(), /Verificação concluída: 7 jogos · 0 alerta/);
  });

  it("erro inesperado vira mensagem, não silêncio", async () => {
    const { ctx, estado, resposta } = cenario();
    estado.ciclo = async () => {
      throw new Error("Steam fora");
    };
    await tratarInteracao(comando("verificar"), ctx);
    assert.match(resposta(), /Não deu certo: Steam fora/);
  });

  it("/alvo definir salva no destino de quem pediu", async () => {
    const { ctx, alvos, usuarios, resposta } = cenario();
    usuarios.set(AMIGO, { discordId: AMIGO, steamId: "1", nomeSteam: "Amigo" });
    await tratarInteracao(alvo("definir", { jogo: "https://store.steampowered.com/app/1174180/x/", valor: 50 }, AMIGO), ctx);
    assert.deepEqual(alvos.get(`discord:${AMIGO}`), [{ appid: 1174180, nome: "Red Dead Redemption 2", alvoCents: 5000 }]);
    assert.equal(alvos.get(`discord:${DONO}`), undefined);
    assert.match(resposta(), /Alvo salvo: \*\*Red Dead Redemption 2\*\* por até \*\*R\$\s50,00\*\* \(hoje: R\$\s74,97\)/);
  });

  it("/alvo definir por parte do nome; nome ambíguo lista as opções", async () => {
    const { ctx, alvos, resposta } = cenario();
    await tratarInteracao(alvo("definir", { jogo: "hogwarts", valor: 20 }), ctx);
    assert.equal(alvos.get(`discord:${DONO}`)![0]!.appid, 990080);
    await tratarInteracao(alvo("definir", { jogo: "red dead", valor: 50 }), ctx);
    assert.match(resposta(), /mais de um jogo[\s\S]*Red Dead Redemption 2[\s\S]*Red Dead Online/);
  });

  it("alvos do arquivo aparecem só para o dono", async () => {
    const { ctx, estado, usuarios, resposta } = cenario();
    usuarios.set(AMIGO, { discordId: AMIGO, steamId: "1", nomeSteam: "Amigo" });
    estado.arquivo.set(990080, 2000);
    await tratarInteracao(alvo("listar", {}, AMIGO), ctx);
    assert.match(resposta(), /ainda não tem preços-alvo/);
    await tratarInteracao(alvo("listar"), ctx);
    assert.match(resposta(), /app 990080 — até R\$\s20,00 \*\(arquivo\)\*/);
  });

  it("/alvo remover: do banco e inexistente", async () => {
    const { ctx, alvos, resposta } = cenario();
    alvos.set(`discord:${DONO}`, [{ appid: 1174180, nome: "Red Dead Redemption 2", alvoCents: 5000 }]);
    await tratarInteracao(alvo("remover", { jogo: "1174180" }), ctx);
    assert.match(resposta(), /Alvo removido: \*\*Red Dead Redemption 2\*\*/);
    await tratarInteracao(alvo("remover", { jogo: "123" }), ctx);
    assert.match(resposta(), /não tem preço-alvo/);
  });
});
