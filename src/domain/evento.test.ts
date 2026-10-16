import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { carregarCalendario, validar } from "../eventos/calendario.ts";
import { eventoDaVez, faseAtual, type EventoSteam } from "./evento.ts";

const E: EventoSteam = {
  id: "w",
  nome: "Winter Sale",
  inicio: new Date("2026-12-17T18:00:00Z"),
  fim: new Date("2027-01-04T18:00:00Z"),
};
const em = (iso: string) => new Date(iso);

describe("faseAtual", () => {
  it("nada antes da véspera", () => assert.equal(faseAtual(E, em("2026-12-16T17:59:59Z")), null));
  it("lembrete nas 24h antes", () => assert.equal(faseAtual(E, em("2026-12-16T18:00:00Z")), "lembrete"));
  it("nos primeiros 30 min ainda não avisa o início (Steam aplicando descontos)", () =>
    assert.equal(faseAtual(E, em("2026-12-17T18:10:00Z")), null));
  it("início depois de 30 min", () => assert.equal(faseAtual(E, em("2026-12-17T18:30:00Z")), "inicio"));
  it("último dia nas 24h finais", () => assert.equal(faseAtual(E, em("2027-01-03T18:00:00Z")), "ultimo_dia"));
  it("nada depois do fim", () => assert.equal(faseAtual(E, em("2027-01-04T18:00:00Z")), null));
});

describe("eventoDaVez", () => {
  it("escolhe o evento com fase ativa", () => {
    const outro = { ...E, id: "s", inicio: em("2027-03-18T17:00:00Z"), fim: em("2027-03-25T17:00:00Z") };
    assert.deepEqual(eventoDaVez([outro, E], em("2026-12-20T00:00:00Z")), { evento: E, fase: "inicio" });
  });
});

describe("calendário", () => {
  it("o calendário do projeto é válido", () => {
    const eventos = carregarCalendario("config/eventos-steam.json");
    assert.ok(eventos.length > 0);
  });

  it("recusa evento com fim antes do início", () => {
    assert.throws(() => validar({ id: "x", nome: "X", inicio: "2027-01-02", fim: "2027-01-01" }, "teste"), /depois de "inicio"/);
  });

  it("recusa data inválida", () => {
    assert.throws(() => validar({ id: "x", nome: "X", inicio: "amanhã", fim: "2027-01-01" }, "teste"), /não é uma data válida/);
  });
});
