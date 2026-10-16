import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { logMudo } from "../lib/log.ts";
import { Gateway, type SocketLike } from "./gateway.ts";

class SocketFalso implements SocketLike {
  enviados: any[] = [];
  fechadoCom: number | null = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  send(dados: string) {
    this.enviados.push(JSON.parse(dados));
  }
  close(codigo = 1000) {
    this.fechadoCom = codigo;
    this.onclose?.({ code: codigo });
  }
  receber(p: { op: number; d?: unknown; s?: number | null; t?: string | null }) {
    this.onmessage?.({ data: JSON.stringify({ d: null, s: null, t: null, ...p }) });
  }
}

function cenario() {
  const sockets: SocketFalso[] = [];
  const interacoes: unknown[] = [];
  const gw = new Gateway({
    token: "TOKEN",
    url: "wss://gateway.discord.gg",
    log: logMudo,
    aoInteragir: (i) => interacoes.push(i),
    criarSocket: (url) => {
      const s = new SocketFalso(url);
      sockets.push(s);
      return s;
    },
  });
  return { gw, sockets, interacoes, atual: () => sockets.at(-1)! };
}

describe("gateway", () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval"] }));
  afterEach(() => mock.timers.reset());

  it("identifica depois do HELLO e manda heartbeat no intervalo", () => {
    const { gw, atual } = cenario();
    gw.conectar();
    assert.equal(atual().url, "wss://gateway.discord.gg/?v=10&encoding=json");
    atual().receber({ op: 10, d: { heartbeat_interval: 1000 } });
    assert.equal(atual().enviados[0].op, 2);
    assert.equal(atual().enviados[0].d.token, "TOKEN");
    assert.equal(atual().enviados[0].d.intents, 0);

    mock.timers.tick(1000);
    assert.deepEqual(atual().enviados[1], { op: 1, d: null });
    gw.parar();
  });

  it("entrega as interações recebidas", () => {
    const { gw, atual, interacoes } = cenario();
    gw.conectar();
    atual().receber({ op: 10, d: { heartbeat_interval: 1000 } });
    atual().receber({ op: 0, t: "READY", s: 1, d: { session_id: "S", resume_gateway_url: "wss://retomar" } });
    atual().receber({ op: 0, t: "INTERACTION_CREATE", s: 2, d: { id: "i1" } });
    assert.deepEqual(interacoes, [{ id: "i1" }]);
    gw.parar();
  });

  it("conexão zumbi (sem ACK): fecha, reconecta e retoma a sessão", () => {
    const { gw, sockets, atual } = cenario();
    gw.conectar();
    atual().receber({ op: 10, d: { heartbeat_interval: 1000 } });
    atual().receber({ op: 0, t: "READY", s: 5, d: { session_id: "S", resume_gateway_url: "wss://retomar" } });

    mock.timers.tick(1000); // heartbeat enviado, nenhum ACK chega
    mock.timers.tick(1000); // próximo tick percebe a falta de ACK
    assert.equal(sockets[0]!.fechadoCom, 4000);

    mock.timers.tick(1000); // espera de reconexão
    assert.equal(sockets.length, 2);
    assert.equal(atual().url, "wss://retomar/?v=10&encoding=json");
    atual().receber({ op: 10, d: { heartbeat_interval: 1000 } });
    assert.deepEqual(atual().enviados[0], { op: 6, d: { token: "TOKEN", session_id: "S", seq: 5 } });
    gw.parar();
  });

  it("token recusado (4004): não fica tentando reconectar", () => {
    const { gw, sockets, atual } = cenario();
    gw.conectar();
    atual().close(4004);
    mock.timers.tick(120_000);
    assert.equal(sockets.length, 1);
    gw.parar();
  });

  it("sessão inválida sem retomada: identifica de novo", () => {
    const { gw, atual } = cenario();
    gw.conectar();
    atual().receber({ op: 10, d: { heartbeat_interval: 1000 } });
    atual().receber({ op: 0, t: "READY", s: 3, d: { session_id: "S", resume_gateway_url: "wss://retomar" } });
    atual().receber({ op: 9, d: false });
    mock.timers.tick(1000);
    assert.equal(atual().url, "wss://gateway.discord.gg/?v=10&encoding=json");
    atual().receber({ op: 10, d: { heartbeat_interval: 1000 } });
    assert.equal(atual().enviados[0].op, 2);
    gw.parar();
  });
});
