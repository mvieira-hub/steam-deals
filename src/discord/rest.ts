// Cliente mínimo da API REST do Discord: autenticação do bot, rate limit e erros legíveis.

const API = "https://discord.com/api/v10";
/** Código 50007: o usuário não aceita DM do bot (sem servidor em comum ou DMs desligadas). */
const ERRO_DM_BLOQUEADA = 50007;

export interface Rest {
  chamar<T = unknown>(metodo: string, caminho: string, corpo?: unknown): Promise<T>;
}

export class DiscordRest implements Rest {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  async chamar<T = unknown>(metodo: string, caminho: string, corpo?: unknown, tentativa = 1): Promise<T> {
    const res = await fetch(`${API}${caminho}`, {
      method: metodo,
      headers: { authorization: `Bot ${this.token}`, "content-type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });

    // Rate limit: o Discord diz quanto esperar.
    if (res.status === 429 && tentativa <= 3) {
      const { retry_after } = (await res.json()) as { retry_after: number };
      await new Promise((r) => setTimeout(r, Math.ceil(retry_after * 1000)));
      return this.chamar(metodo, caminho, corpo, tentativa + 1);
    }
    if (res.status === 204) return undefined as T;

    const json = (await res.json()) as T & { code?: number; message?: string };
    if (res.ok) return json;
    if (json.code === ERRO_DM_BLOQUEADA) {
      throw new Error(
        "O Discord recusou a DM: confira se o bot está num servidor em que você também está e se " +
          '"Permitir mensagens diretas de membros do servidor" está ligado nesse servidor.',
      );
    }
    throw new Error(`Discord ${metodo} ${caminho} respondeu ${res.status}: ${json.message ?? ""}`);
  }
}
