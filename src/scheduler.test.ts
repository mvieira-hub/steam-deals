import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { esperaAteProxima } from "./scheduler.ts";

const H = 60 * 60 * 1000;

describe("esperaAteProxima", () => {
  const agora = new Date("2026-10-15T20:00:00Z");

  it("roda na hora na primeira vez", () => {
    assert.equal(esperaAteProxima(null, agora, 2 * H), 0);
  });

  it("espera o que falta do intervalo", () => {
    assert.equal(esperaAteProxima(new Date("2026-10-15T19:30:00Z"), agora, 2 * H), 1.5 * H);
  });

  it("recupera na hora depois de o PC ficar desligado além do intervalo", () => {
    assert.equal(esperaAteProxima(new Date("2026-10-14T08:00:00Z"), agora, 2 * H), 0);
  });
});
