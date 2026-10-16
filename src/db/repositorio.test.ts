import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { abrirBanco, type Db } from "./database.ts";
import * as repo from "./repositorio.ts";

describe("preços-alvo no banco", () => {
  let db: Db;
  const agora = new Date("2026-10-16T12:00:00Z");
  beforeEach(() => (db = abrirBanco(":memory:")));

  it("definir, atualizar, listar e remover por destino", () => {
    repo.definirAlvo(db, "discord:1", { appid: 10, nome: "Jogo", alvoCents: 5000 }, agora);
    repo.definirAlvo(db, "discord:1", { appid: 10, nome: "Jogo", alvoCents: 4000 }, agora);
    repo.definirAlvo(db, "discord:2", { appid: 10, nome: "Jogo", alvoCents: 9900 }, agora);
    assert.deepEqual(repo.listarAlvos(db, "discord:1"), [{ appid: 10, nome: "Jogo", alvoCents: 4000 }]);

    assert.equal(repo.removerAlvo(db, "discord:1", 10), true);
    assert.equal(repo.removerAlvo(db, "discord:1", 10), false);
    assert.equal(repo.listarAlvos(db, "discord:2").length, 1, "o alvo de outra pessoa continua");
  });

  it("acha jogo conhecido por parte do nome", () => {
    repo.registrarPrecos(
      db,
      [
        { appid: 1, name: "Red Dead Redemption 2", finalCents: 1, originalCents: 1, discountPct: 0, discountEndsAt: null, reviewPct: null, reviewLabel: null, url: "" },
        { appid: 2, name: "Hogwarts Legacy", finalCents: 1, originalCents: 1, discountPct: 0, discountEndsAt: null, reviewPct: null, reviewLabel: null, url: "" },
      ],
      agora,
    );
    assert.deepEqual(repo.buscarJogosPorNome(db, "red dead"), [{ appid: 1, nome: "Red Dead Redemption 2" }]);
  });
});
