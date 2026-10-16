import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { carregarAlvos, extrairAppid } from "./precos-alvo.ts";

const arquivo = (conteudo: unknown) => {
  const caminho = join(mkdtempSync(join(tmpdir(), "alvos-")), "precos-alvo.json");
  writeFileSync(caminho, JSON.stringify(conteudo));
  return caminho;
};

describe("extrairAppid", () => {
  it("aceita o link da loja", () =>
    assert.equal(extrairAppid("https://store.steampowered.com/app/1174180/Red_Dead_Redemption_2/"), 1174180));
  it("aceita número ou texto com número", () => {
    assert.equal(extrairAppid(1174180), 1174180);
    assert.equal(extrairAppid(" 1174180 "), 1174180);
  });
  it("recusa o resto", () => assert.equal(extrairAppid("Red Dead"), null));
});

describe("carregarAlvos", () => {
  it("converte reais em centavos", () => {
    const alvos = carregarAlvos(arquivo({ alvos: [{ jogo: "https://store.steampowered.com/app/10/x", ate: 49.9 }] }));
    assert.equal(alvos.get(10), 4990);
  });
  it("arquivo ausente = sem alvos", () => assert.equal(carregarAlvos("/nao/existe.json").size, 0));
  it("o arquivo do projeto é válido", () => assert.ok(carregarAlvos("config/precos-alvo.json")));
  it("erro claro quando o jogo não é reconhecido", () =>
    assert.throws(() => carregarAlvos(arquivo({ alvos: [{ jogo: "Red Dead", nome: "RDR2", ate: 50 }] })), /alvo 1 \(RDR2\).*link da loja/));
  it("erro claro quando o valor é inválido", () =>
    assert.throws(() => carregarAlvos(arquivo({ alvos: [{ jogo: 10, ate: "50" }] })), /"ate" precisa ser um valor em reais/));
});
