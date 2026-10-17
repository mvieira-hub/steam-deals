import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { criarMonitor } from "./monitor.ts";
import { logMudo } from "./log.ts";

describe("monitor", () => {
  it("sem URL, não faz nada", async () => {
    await criarMonitor("", logMudo).ok(); // não lança
  });

  it("falha do monitor não derruba o bot", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("rede fora");
    };
    try {
      await criarMonitor("https://hc-ping.com/abc", logMudo).ok(); // engole o erro
    } finally {
      globalThis.fetch = original;
    }
  });

  it("chama a URL configurada", async () => {
    const original = globalThis.fetch;
    let chamada: string | undefined;
    globalThis.fetch = async (u: any) => {
      chamada = String(u);
      return new Response("OK");
    };
    try {
      await criarMonitor("https://hc-ping.com/abc", logMudo).ok();
      assert.equal(chamada, "https://hc-ping.com/abc");
    } finally {
      globalThis.fetch = original;
    }
  });
});
