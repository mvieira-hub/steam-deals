// Comandos de barra na DM do bot: /verificar e /alvo (definir, remover, listar).
// Só o dono (DISCORD_USER_ID) pode usar; qualquer outra pessoa recebe "bot privado".

import { extrairAppid } from "../alvos/precos-alvo.ts";
import type { AlvoSalvo } from "../db/repositorio.ts";
import { brl } from "../lib/format.ts";
import { mensagemDeErro, type Log } from "../lib/log.ts";
import type { Rest } from "./rest.ts";

const OPCAO = { SUBCOMANDO: 1, TEXTO: 3, NUMERO: 10 } as const;
/** contexts: 1 = DM com o bot. integration_types: 0 = instalado em servidor. */
const SO_NA_DM = { contexts: [1], integration_types: [0] };

const opcaoJogo = (descricao: string) => ({
  type: OPCAO.TEXTO,
  name: "jogo",
  description: descricao,
  required: true,
});

export const DEFINICOES = [
  { name: "verificar", description: "Verifica agora os preços da sua wishlist", ...SO_NA_DM },
  {
    name: "alvo",
    description: "Preço-alvo: aviso quando um jogo chegar no preço que você quer",
    ...SO_NA_DM,
    options: [
      {
        type: OPCAO.SUBCOMANDO,
        name: "definir",
        description: "Avisa quando o jogo chegar neste preço (ou abaixo)",
        options: [
          opcaoJogo("Link da loja, número do app ou parte do nome de um jogo da wishlist"),
          { type: OPCAO.NUMERO, name: "valor", description: "Preço máximo em reais, ex.: 49.90", required: true, min_value: 0.01 },
        ],
      },
      {
        type: OPCAO.SUBCOMANDO,
        name: "remover",
        description: "Remove o preço-alvo de um jogo",
        options: [opcaoJogo("Link da loja, número do app ou parte do nome")],
      },
      { type: OPCAO.SUBCOMANDO, name: "listar", description: "Mostra seus preços-alvo" },
    ],
  },
];

export interface ContextoComandos {
  rest: Rest;
  appId: string;
  donoId: string;
  rodarCiclo(): Promise<{ ok: boolean; resumo: string }>;
  alvos: {
    definir(alvo: AlvoSalvo): void;
    remover(appid: number): boolean;
    doBanco(): AlvoSalvo[];
    /** appid → centavos, do arquivo config/precos-alvo.json */
    doArquivo(): Map<number, number>;
  };
  buscarPorNome(texto: string): { appid: number; nome: string }[];
  buscarPreco(appid: number): Promise<{ nome: string; finalCents: number | null } | null>;
  log: Log;
}

interface Interacao {
  id: string;
  token: string;
  type: number;
  user?: { id: string };
  member?: { user: { id: string } };
  data?: { name: string; options?: OpcaoRecebida[] };
}
interface OpcaoRecebida {
  name: string;
  type: number;
  value?: string | number;
  options?: OpcaoRecebida[];
}

const TIPO_COMANDO = 2;
const RESPOSTA = { MENSAGEM: 4, ADIADA: 5 } as const;
const SO_PARA_VOCE = 64;

export async function registrarComandos(rest: Rest, appId: string): Promise<void> {
  await rest.chamar("PUT", `/applications/${appId}/commands`, DEFINICOES);
}

export async function tratarInteracao(bruta: unknown, ctx: ContextoComandos): Promise<void> {
  const i = bruta as Interacao;
  if (i.type !== TIPO_COMANDO || !i.data) return;

  const autor = i.user?.id ?? i.member?.user.id;
  if (autor !== ctx.donoId) {
    await responder(ctx, i, { type: RESPOSTA.MENSAGEM, data: { content: "Este bot é privado.", flags: SO_PARA_VOCE } });
    return;
  }

  // Tudo é respondido em dois passos: "pensando..." na hora e o resultado depois
  // (o Discord exige resposta em até 3 s; consultar a Steam pode demorar mais).
  await responder(ctx, i, { type: RESPOSTA.ADIADA });
  let texto: string;
  try {
    texto = await executar(i.data, ctx);
  } catch (err) {
    ctx.log.error(`Comando /${i.data.name} falhou: ${mensagemDeErro(err)}`);
    texto = `❌ Não deu certo: ${mensagemDeErro(err)}`;
  }
  await ctx.rest.chamar("PATCH", `/webhooks/${ctx.appId}/${i.token}/messages/@original`, { content: texto });
}

function responder(ctx: ContextoComandos, i: Interacao, corpo: unknown) {
  return ctx.rest.chamar("POST", `/interactions/${i.id}/${i.token}/callback`, corpo);
}

async function executar(data: NonNullable<Interacao["data"]>, ctx: ContextoComandos): Promise<string> {
  if (data.name === "verificar") {
    const r = await ctx.rodarCiclo();
    return r.ok ? `🔎 Verificação concluída: ${r.resumo}` : `❌ A verificação falhou: ${r.resumo}`;
  }
  if (data.name === "alvo") {
    const sub = data.options?.[0];
    const valor = (nome: string) => sub?.options?.find((o) => o.name === nome)?.value;
    if (sub?.name === "definir") return definir(String(valor("jogo") ?? ""), Number(valor("valor")), ctx);
    if (sub?.name === "remover") return remover(String(valor("jogo") ?? ""), ctx);
    if (sub?.name === "listar") return listar(ctx);
  }
  return "Comando desconhecido.";
}

/** Link, número do app ou parte do nome de um jogo que o bot já conhece. */
function resolverAppid(texto: string, ctx: ContextoComandos): { appid: number } | { erro: string } {
  const appid = extrairAppid(texto);
  if (appid) return { appid };
  const achados = ctx.buscarPorNome(texto);
  if (achados.length === 1) return { appid: achados[0]!.appid };
  if (achados.length === 0) {
    return { erro: `Não achei "${texto}" entre os jogos da sua wishlist. Use o link da loja (store.steampowered.com/app/...).` };
  }
  return { erro: `Achei mais de um jogo com "${texto}":\n${achados.map((j) => `• ${j.nome}`).join("\n")}\nSeja mais específico ou use o link da loja.` };
}

async function definir(texto: string, valor: number, ctx: ContextoComandos): Promise<string> {
  const r = resolverAppid(texto, ctx);
  if ("erro" in r) return r.erro;
  if (!(valor > 0)) return "O valor precisa ser maior que zero.";

  const jogo = await ctx.buscarPreco(r.appid);
  if (!jogo) return `Não encontrei o app ${r.appid} na loja da Steam.`;

  const alvoCents = Math.round(valor * 100);
  ctx.alvos.definir({ appid: r.appid, nome: jogo.nome, alvoCents });
  const hoje = jogo.finalCents === null ? "fora de venda hoje" : `hoje: ${brl(jogo.finalCents)}`;
  const jaChegou =
    jogo.finalCents !== null && jogo.finalCents <= alvoCents
      ? "\nEle já está nesse preço: o aviso chega na próxima verificação (ou use /verificar)."
      : "\nAviso quando chegar.";
  return `🎯 Alvo salvo: **${jogo.nome}** por até **${brl(alvoCents)}** (${hoje}).${jaChegou}`;
}

function remover(texto: string, ctx: ContextoComandos): string {
  const r = resolverAppid(texto, ctx);
  if ("erro" in r) return r.erro;
  const nome = ctx.alvos.doBanco().find((a) => a.appid === r.appid)?.nome ?? `app ${r.appid}`;
  if (ctx.alvos.remover(r.appid)) return `Alvo removido: **${nome}**.`;
  if (ctx.alvos.doArquivo().has(r.appid)) {
    return "Esse alvo está no arquivo config/precos-alvo.json: remova por lá.";
  }
  return "Esse jogo não tem preço-alvo.";
}

function listar(ctx: ContextoComandos): string {
  const banco = ctx.alvos.doBanco();
  const arquivo = [...ctx.alvos.doArquivo()].filter(([appid]) => !banco.some((a) => a.appid === appid));
  if (banco.length === 0 && arquivo.length === 0) return "Você ainda não tem preços-alvo. Use **/alvo definir**.";
  const linhas = [
    ...banco.map((a) => `🎯 **${a.nome}** — até ${brl(a.alvoCents)}`),
    ...arquivo.map(([appid, cents]) => `🎯 app ${appid} — até ${brl(cents)} *(arquivo)*`),
  ];
  return `**Seus preços-alvo**\n${linhas.join("\n")}`;
}
