import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { caminhoDoPerfil, lerPerfilXml, resolverPerfil } from "./steam-client.ts";

describe("caminhoDoPerfil", () => {
  it("aceita link com número, link com nome, número e nome", () => {
    assert.equal(caminhoDoPerfil("https://steamcommunity.com/profiles/76561198059563647/"), "profiles/76561198059563647");
    assert.equal(caminhoDoPerfil("steamcommunity.com/id/meunome/wishlist"), "id/meunome");
    assert.equal(caminhoDoPerfil(" 76561198059563647 "), "profiles/76561198059563647");
    assert.equal(caminhoDoPerfil("meu_nome-1"), "id/meu_nome-1");
  });
  it("recusa texto que não parece perfil", () => {
    assert.equal(caminhoDoPerfil("isso não é um perfil"), null);
    assert.equal(caminhoDoPerfil("https://store.steampowered.com/app/10"), null);
  });
});

describe("lerPerfilXml", () => {
  it("lê número e nome", () => {
    const xml = "<profile><steamID64>76561197960287930</steamID64><steamID><![CDATA[Rabscuttle]]></steamID></profile>";
    assert.deepEqual(lerPerfilXml(xml), { steamId: "76561197960287930", nome: "Rabscuttle" });
  });
  it("perfil inexistente vira erro claro", () => {
    assert.throws(
      () => lerPerfilXml("<response><error><![CDATA[The specified profile could not be found.]]></error></response>"),
      /não encontrado/,
    );
  });
});

describe("resolverPerfil com a Steam limitando (429)", () => {
  const XML_OK = "<profile><steamID64>76561198000000009</steamID64><steamID><![CDATA[Rapha]]></steamID></profile>";
  /** Steam falsa: responde as N primeiras chamadas com 429 e depois com o XML. */
  function steam(falhasAntes: number, xml = XML_OK) {
    let chamadas = 0;
    const buscar = async () => (chamadas++ < falhasAntes ? new Response("", { status: 429 }) : new Response(xml));
    return { buscar, esperar: async () => {}, chamadas: () => chamadas };
  }

  it("tenta de novo e consegue", async () => {
    const s = steam(2);
    assert.deepEqual(await resolverPerfil("rapha", s.buscar, s.esperar), { steamId: "76561198000000009", nome: "Rapha" });
    assert.equal(s.chamadas(), 3);
  });

  it("nome personalizado com a Steam bloqueando direto: mensagem clara", async () => {
    const s = steam(99);
    await assert.rejects(resolverPerfil("rapha", s.buscar, s.esperar), /limitando consultas.*alguns minutos/s);
  });

  it("link com número: cadastra mesmo com a Steam bloqueando (usa o número como nome)", async () => {
    const s = steam(99);
    const p = await resolverPerfil("https://steamcommunity.com/profiles/76561198069205200", s.buscar, s.esperar);
    assert.deepEqual(p, { steamId: "76561198069205200", nome: "76561198069205200" });
  });

  it("link com número de perfil inexistente continua sendo erro", async () => {
    const s = steam(0, "<response><error><![CDATA[The specified profile could not be found.]]></error></response>");
    await assert.rejects(resolverPerfil("76561198000000000", s.buscar, s.esperar), /não encontrado/);
  });
});
