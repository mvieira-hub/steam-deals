export interface Log {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const hora = () => new Date().toLocaleString("pt-BR", { timeZone: process.env.TZ || "America/Sao_Paulo" });

export const log: Log = {
  info: (msg) => console.log(`[${hora()}] ${msg}`),
  warn: (msg) => console.warn(`[${hora()}] ⚠️  ${msg}`),
  error: (msg) => console.error(`[${hora()}] ❌ ${msg}`),
};

export const logMudo: Log = { info() {}, warn() {}, error() {} };

export const mensagemDeErro = (err: unknown) => (err instanceof Error ? err.message : String(err));
