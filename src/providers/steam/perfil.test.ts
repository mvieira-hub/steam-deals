import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { caminhoDoPerfil, lerPerfilXml } from "./steam-client.ts";

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
