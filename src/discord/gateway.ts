// Conexão com o gateway do Discord (WebSocket nativo do Node 24, sem biblioteca).
// Só serve para RECEBER os comandos (/verificar, /alvo): o envio continua pela API REST.
// Mantém heartbeat, detecta conexão zumbi e reconecta retomando a sessão quando possível.
// Protocolo: https://discord.com/developers/docs/events/gateway

import { mensagemDeErro, type Log } from "../lib/log.ts";

export interface SocketLike {
  send(dados: string): void;
  close(codigo?: number): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

const OP = { DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, RESUME: 6, RECONNECT: 7, INVALID_SESSION: 9, HELLO: 10, ACK: 11 } as const;

/** Fechamentos em que reconectar não adianta (token inválido, intents não permitidas...). */
const FECHAMENTOS_FATAIS = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
/** Fechamentos em que a sessão não pode ser retomada: precisa identificar de novo. */
const FECHAMENTOS_SEM_RETOMADA = new Set([4007, 4009]);
/** Código que usamos ao fechar de propósito: mantém a sessão retomável (1000/1001 a invalidariam). */
const FECHAR_PARA_RETOMAR = 4000;

export interface OpcoesGateway {
  token: string;
  /** Endereço base do gateway, ex.: wss://gateway.discord.gg */
  url: string;
  aoInteragir: (interacao: unknown) => void;
  log: Log;
  criarSocket?: (url: string) => SocketLike;
}

export class Gateway {
  private readonly o: OpcoesGateway;
  private readonly criarSocket: (url: string) => SocketLike;
  private socket: SocketLike | null = null;
  private heartbeat: NodeJS.Timeout | undefined;
  private ackRecebido = true;
  private seq: number | null = null;
  private sessao: string | null = null;
  private urlRetomada: string | null = null;
  private tentativas = 0;
  private parado = false;

  constructor(o: OpcoesGateway) {
    this.o = o;
    this.criarSocket = o.criarSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
  }

  conectar(): void {
    const base = this.sessao && this.urlRetomada ? this.urlRetomada : this.o.url;
    const socket = this.criarSocket(`${base}/?v=10&encoding=json`);
    this.socket = socket;
    socket.onmessage = (ev) => this.aoReceber(String(ev.data));
    socket.onerror = (ev) => this.o.log.warn(`Gateway do Discord: erro na conexão (${mensagemDeErro(ev)}).`);
    socket.onclose = (ev) => this.aoFechar(ev.code);
  }

  parar(): void {
    this.parado = true;
    clearInterval(this.heartbeat);
    this.socket?.close(1000);
  }

  private enviar(op: number, d: unknown): void {
    this.socket?.send(JSON.stringify({ op, d }));
  }

  private aoReceber(texto: string): void {
    const p = JSON.parse(texto) as { op: number; d: any; s: number | null; t: string | null };
    if (p.s !== null && p.s !== undefined) this.seq = p.s;

    switch (p.op) {
      case OP.HELLO:
        this.iniciarHeartbeat(p.d.heartbeat_interval);
        if (this.sessao && this.seq !== null) {
          this.enviar(OP.RESUME, { token: this.o.token, session_id: this.sessao, seq: this.seq });
        } else {
          this.identificar();
        }
        break;
      case OP.ACK:
        this.ackRecebido = true;
        break;
      case OP.HEARTBEAT:
        this.enviar(OP.HEARTBEAT, this.seq);
        break;
      case OP.RECONNECT:
        this.socket?.close(FECHAR_PARA_RETOMAR);
        break;
      case OP.INVALID_SESSION:
        if (!p.d) this.esquecerSessao();
        this.socket?.close(FECHAR_PARA_RETOMAR);
        break;
      case OP.DISPATCH:
        this.aoEvento(p.t, p.d);
        break;
    }
  }

  private aoEvento(tipo: string | null, d: any): void {
    if (tipo === "READY") {
      this.sessao = d.session_id;
      this.urlRetomada = d.resume_gateway_url;
      this.tentativas = 0;
      this.o.log.info("Comandos do Discord ativos (/verificar, /alvo).");
    } else if (tipo === "RESUMED") {
      this.tentativas = 0;
    } else if (tipo === "INTERACTION_CREATE") {
      this.o.aoInteragir(d);
    }
  }

  private identificar(): void {
    this.enviar(OP.IDENTIFY, {
      token: this.o.token,
      intents: 0, // comandos chegam sem precisar de nenhuma intent
      properties: { os: "linux", browser: "steam-deals", device: "steam-deals" },
      presence: { status: "online", since: null, afk: false, activities: [{ name: "promoções da sua wishlist", type: 3 }] },
    });
  }

  private iniciarHeartbeat(intervaloMs: number): void {
    clearInterval(this.heartbeat);
    this.ackRecebido = true;
    this.heartbeat = setInterval(() => {
      // Sem resposta ao último sinal: conexão zumbi. Fecha e retoma.
      if (!this.ackRecebido) {
        this.o.log.warn("Gateway do Discord sem resposta; reconectando.");
        this.socket?.close(FECHAR_PARA_RETOMAR);
        return;
      }
      this.ackRecebido = false;
      this.enviar(OP.HEARTBEAT, this.seq);
    }, intervaloMs);
  }

  private aoFechar(codigo: number): void {
    clearInterval(this.heartbeat);
    this.socket = null;
    if (this.parado) return;
    if (FECHAMENTOS_FATAIS.has(codigo)) {
      this.o.log.error(`Gateway do Discord recusou a conexão (código ${codigo}); comandos desligados. Confira o token.`);
      return;
    }
    if (FECHAMENTOS_SEM_RETOMADA.has(codigo)) this.esquecerSessao();
    const espera = Math.min(60_000, 1000 * 2 ** this.tentativas++);
    setTimeout(() => this.conectar(), espera);
  }

  private esquecerSessao(): void {
    this.sessao = null;
    this.urlRetomada = null;
    this.seq = null;
  }
}
