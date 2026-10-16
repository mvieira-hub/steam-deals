// Envia alertas por mensagem privada (DM) usando a API REST do Discord.
// Requisito do Discord: o bot e o usuário precisam ter pelo menos um servidor em comum.

import type { Rest } from "../../discord/rest.ts";
import type { Mensagem, Notifier } from "../../domain/alerta.ts";
import { montarEmbed, montarLista } from "./embed.ts";

/** Limite do Discord por mensagem. */
const EMBEDS_POR_MENSAGEM = 10;

export class DiscordDmNotifier implements Notifier {
  private readonly rest: Rest;
  private readonly userId: string;

  constructor(rest: Rest, userId: string) {
    this.rest = rest;
    this.userId = userId;
  }

  async enviar(m: Mensagem): Promise<void> {
    const canal = await this.abrirDm();
    const cabecalho = m.texto ? `**${m.titulo}**\n${m.texto}` : `**${m.titulo}**`;

    if (m.alertas.length === 0) {
      await this.postar(canal, { content: cabecalho });
      return;
    }
    if (m.formato === "lista") {
      await this.postar(canal, { content: cabecalho, embeds: [montarLista(m.alertas)] });
      return;
    }
    for (let i = 0; i < m.alertas.length; i += EMBEDS_POR_MENSAGEM) {
      const lote = m.alertas.slice(i, i + EMBEDS_POR_MENSAGEM);
      await this.postar(canal, { content: i === 0 ? cabecalho : undefined, embeds: lote.map(montarEmbed) });
    }
  }

  private postar(canal: string, corpo: { content?: string; embeds?: unknown[] }) {
    return this.rest.chamar("POST", `/channels/${canal}/messages`, corpo);
  }

  private async abrirDm(): Promise<string> {
    const canal = await this.rest.chamar<{ id: string }>("POST", "/users/@me/channels", { recipient_id: this.userId });
    return canal.id;
  }
}
