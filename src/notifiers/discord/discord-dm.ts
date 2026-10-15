// Envia alertas por mensagem privada (DM) usando só a API REST do Discord:
// o bot não precisa ficar conectado ao gateway para isso.
// Requisito do Discord: o bot e o usuário precisam ter pelo menos um servidor em comum.

import type { Alerta, Notifier } from "../../domain/alerta.ts";
import { montarEmbed } from "./embed.ts";

const API = "https://discord.com/api/v10";
/** Limite do Discord por mensagem. */
const EMBEDS_POR_MENSAGEM = 10;
/** Código 50007: o usuário não aceita DM do bot (sem servidor em comum ou DMs desligadas). */
const ERRO_DM_BLOQUEADA = 50007;

export class DiscordDmNotifier implements Notifier {
  private readonly token: string;
  private readonly userId: string;

  constructor(token: string, userId: string) {
    this.token = token;
    this.userId = userId;
  }

  async enviar(alertas: Alerta[]): Promise<void> {
    if (alertas.length === 0) return;
    const canal = await this.abrirDm();

    for (let i = 0; i < alertas.length; i += EMBEDS_POR_MENSAGEM) {
      const lote = alertas.slice(i, i + EMBEDS_POR_MENSAGEM);
      const cabecalho = i === 0 ? resumo(alertas.length) : undefined;
      await this.chamar("POST", `/channels/${canal}/messages`, {
        content: cabecalho,
        embeds: lote.map(montarEmbed),
      });
    }
  }

  private async abrirDm(): Promise<string> {
    const canal = await this.chamar<{ id: string }>("POST", "/users/@me/channels", { recipient_id: this.userId });
    return canal.id;
  }

  private async chamar<T>(metodo: string, caminho: string, corpo: unknown, tentativa = 1): Promise<T> {
    const res = await fetch(`${API}${caminho}`, {
      method: metodo,
      headers: { authorization: `Bot ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(corpo),
    });

    // Rate limit: o Discord diz quanto esperar.
    if (res.status === 429 && tentativa <= 3) {
      const { retry_after } = (await res.json()) as { retry_after: number };
      await new Promise((r) => setTimeout(r, Math.ceil(retry_after * 1000)));
      return this.chamar(metodo, caminho, corpo, tentativa + 1);
    }

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

function resumo(total: number): string {
  return total === 1 ? "🎮 **1 oferta** na sua wishlist" : `🎮 **${total} ofertas** na sua wishlist`;
}
