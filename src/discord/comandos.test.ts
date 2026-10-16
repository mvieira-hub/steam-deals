import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AlvoSalvo } from "../db/repositorio.ts";
import { logMudo } from "../lib/log.ts";
import { tratarInteracao, type ContextoComandos } from "./comandos.ts";
import type { Rest } from "./rest.ts";

const DONO = "327";
const RDR2 = { appid: 1174180, nome: "Red Dead Redemption 2" };

function cenario() {
  const chamadas: { metodo: string; caminho: string; corpo: any }[] = [];
  const banco: AlvoSalvo[] = [];
  const estado = {
    arquivo: new Map<number, number>(),
    jogos: [RDR2, { appid: 990080, nome: "Hogwarts Legacy" }, { appid: 1, nome: "Red Dead Online" }],
    precoHoje: 7497 as number | null,
    ciclo: async () => ({ ok: true, resumo: "21 jogos · 1 alerta(s) novo(s)" }),
  };
  const rest: Rest = {
    chamar: async (metodo, caminho, corpo) => {
      chamadas.push({ metodo, caminho, corpo });
      return undefined as never;
    },
  };
  const ctx: ContextoComandos = {
    rest,
    appId: "app",
    donoId: DONO,
    rodarCiclo: () => estado.ciclo(),
    alvos: {
      definir: (a) => {
        const i = banco.findIndex((b) => b.appid === a.appid);
        if (i >= 0) banco[i] = a;
        else banco.push(a);
      },
      remover: (appid) => {
        const i = banco.findIndex((b) => b.appid === appid);
        if (i < 0) return false;
        banco.splice(i, 1);
        return true;
      },
      doBanco: () => banco,
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
  const resposta = () => chamadas.find((c) => c.metodo === "PATCH")?.corpo.content as string;
  return { chamadas, banco, estado, ctx, resposta };
}

const comando = (name: string, options?: unknown[], autor = DONO) => ({
  id: "i1",
  token: "tok",
  type: 2,
  user: { id: autor },
  data: { name, options },
});
const alvo = (sub: string, opcoes: Record<string, string | number> = {}) =>
  comando("alvo", [{ type: 1, name: sub, options: Object.entries(opcoes).map(([name, value]) => ({ name, value })) }]);

describe("comandos", () => {
  it("só o dono pode usar", async () => {
    const { ctx, chamadas } = cenario();
    await tratarInteracao(comando("verificar", undefined, "outra-pessoa"), ctx);
    assert.equal(chamadas.length, 1);
    assert.deepEqual(chamadas[0]!.corpo, { type: 4, data: { content: "Este bot é privado.", flags: 64 } });
  });

  it("/verificar responde 'pensando' e depois o resumo do ciclo", async () => {
    const { ctx, chamadas, resposta } = cenario();
    await tratarInteracao(comando("verificar"), ctx);
    assert.deepEqual(chamadas[0]!.corpo, { type: 5 });
    assert.equal(chamadas[0]!.caminho, "/interactions/i1/tok/callback");
    assert.equal(chamadas[1]!.caminho, "/webhooks/app/tok/messages/@original");
    assert.match(resposta(), /Verificação concluída: 21 jogos/);
  });

  it("erro inesperado vira mensagem, não silêncio", async () => {
    const { ctx, estado, resposta } = cenario();
    estado.ciclo = async () => {
      throw new Error("Steam fora");
    };
    await tratarInteracao(comando("verificar"), ctx);
    assert.match(resposta(), /Não deu certo: Steam fora/);
  });

  it("/alvo definir pelo link salva com o nome da loja", async () => {
    const { ctx, banco, resposta } = cenario();
    await tratarInteracao(alvo("definir", { jogo: "https://store.steampowered.com/app/1174180/x/", valor: 50 }), ctx);
    assert.deepEqual(banco, [{ appid: 1174180, nome: "Red Dead Redemption 2", alvoCents: 5000 }]);
    assert.match(resposta(), /Alvo salvo: \*\*Red Dead Redemption 2\*\* por até \*\*R\$\s50,00\*\* \(hoje: R\$\s74,97\)/);
  });

  it("/alvo definir por parte do nome, quando só um jogo bate", async () => {
    const { ctx, banco } = cenario();
    await tratarInteracao(alvo("definir", { jogo: "hogwarts", valor: 20 }), ctx);
    assert.equal(banco[0]!.appid, 990080);
  });

  it("/alvo definir com nome ambíguo lista as opções e não salva", async () => {
    const { ctx, banco, resposta } = cenario();
    await tratarInteracao(alvo("definir", { jogo: "red dead", valor: 50 }), ctx);
    assert.equal(banco.length, 0);
    assert.match(resposta(), /mais de um jogo[\s\S]*Red Dead Redemption 2[\s\S]*Red Dead Online/);
  });

  it("/alvo definir avisa quando o jogo já está no preço", async () => {
    const { ctx, resposta } = cenario();
    await tratarInteracao(alvo("definir", { jogo: "1174180", valor: 80 }), ctx);
    assert.match(resposta(), /já está nesse preço/);
  });

  it("/alvo remover: do banco, do arquivo e inexistente", async () => {
    const { ctx, banco, estado, resposta, chamadas } = cenario();
    banco.push({ appid: 1174180, nome: "Red Dead Redemption 2", alvoCents: 5000 });
    await tratarInteracao(alvo("remover", { jogo: "1174180" }), ctx);
    assert.equal(banco.length, 0);
    assert.match(resposta(), /Alvo removido: \*\*Red Dead Redemption 2\*\*/);

    chamadas.length = 0;
    estado.arquivo.set(990080, 2000);
    await tratarInteracao(alvo("remover", { jogo: "990080" }), ctx);
    assert.match(resposta(), /config\/precos-alvo\.json/);

    chamadas.length = 0;
    await tratarInteracao(alvo("remover", { jogo: "123" }), ctx);
    assert.match(resposta(), /não tem preço-alvo/);
  });

  it("/alvo listar mostra banco e arquivo", async () => {
    const { ctx, banco, estado, resposta, chamadas } = cenario();
    await tratarInteracao(alvo("listar"), ctx);
    assert.match(resposta(), /ainda não tem preços-alvo/);

    chamadas.length = 0;
    banco.push({ appid: 1174180, nome: "Red Dead Redemption 2", alvoCents: 5000 });
    estado.arquivo.set(990080, 2000);
    await tratarInteracao(alvo("listar"), ctx);
    assert.match(resposta(), /Red Dead Redemption 2\*\* — até R\$\s50,00/);
    assert.match(resposta(), /app 990080 — até R\$\s20,00 \*\(arquivo\)\*/);
  });
});
