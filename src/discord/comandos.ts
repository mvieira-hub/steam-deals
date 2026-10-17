// Comandos de barra na DM do bot.
//   Qualquer pessoa: /cadastrar (perfil da Steam).
//   Cadastrados: /verificar, /alvo (definir, remover, listar), /descadastrar.
//   Só o dono (DISCORD_USER_ID): /usuarios.

import { extrairAppid } from "../alvos/precos-alvo.ts";
import { destinoDe, type AlvoSalvo, type Usuario } from "../db/repositorio.ts";
import type { ResumoUsuario } from "../jobs/verificar-ofertas.ts";
import { linhaDoUsuario } from "../jobs/verificar-ofertas.ts";
import { brl } from "../lib/format.ts";
import { mensagemDeErro, type Log } from "../lib/log.ts";
import { WishlistPrivadaError, type PerfilSteam } from "../providers/steam/steam-client.ts";
import type { Rest } from "./rest.ts";

const OPCAO = { SUBCOMANDO: 1, TEXTO: 3, NUMERO: 10 } as const;
/** contexts: 1 = DM com o bot. integration_types: 0 = instalado em servidor. */
const SO_NA_DM = { contexts: [1], integration_types: [0] };

const opcaoJogo = (descricao: string) => ({ type: OPCAO.TEXTO, name: "jogo", description: descricao, required: true });

export const DEFINICOES = [
  {
    name: "cadastrar",
    description: "Começa a receber alertas da sua wishlist da Steam",
    ...SO_NA_DM,
    options: [
      {
        type: OPCAO.TEXTO,
        name: "perfil",
        description: "Link do seu perfil da Steam (steamcommunity.com/id/... ou /profiles/...)",
        required: true,
      },
    ],
  },
  { name: "descadastrar", description: "Para de receber alertas e apaga seus dados do bot", ...SO_NA_DM },
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
  { name: "usuarios", description: "(Dono do bot) Lista quem está cadastrado", ...SO_NA_DM },
];

export interface ContextoComandos {
  rest: Rest;
  appId: string;
  donoId: string;
  rodarCiclo(): Promise<{ ok: boolean; resumo: string; porUsuario: Map<string, ResumoUsuario> }>;
  usuarios: {
    buscar(discordId: string): Usuario | null;
    salvar(u: Usuario): void;
    apagar(discordId: string): boolean;
    listar(): Usuario[];
    /** Máximo de pessoas cadastradas (o dono não conta para bloquear a si mesmo). */
    limite: number;
  };
  /** Descobre SteamID64 e nome a partir do que a pessoa colou. */
  resolverPerfil(texto: string): Promise<PerfilSteam>;
  /** Quantos jogos há na wishlist; lança WishlistPrivadaError se ela estiver privada. */
  contarWishlist(steamId: string): Promise<number>;
  alvos: {
    definir(destino: string, alvo: AlvoSalvo): void;
    remover(destino: string, appid: number): boolean;
    doBanco(destino: string): AlvoSalvo[];
    /** appid → centavos, do arquivo config/precos-alvo.json (vale só para o dono). */
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
const RESPOSTA = { ADIADA: 5 } as const;

const NAO_CADASTRADO =
  "Você ainda não está cadastrado. Use **/cadastrar** com o link do seu perfil da Steam " +
  "(ex.: `https://steamcommunity.com/id/seunome`).";

const COMO_LIBERAR_WISHLIST =
  "Sua wishlist está privada. Na Steam: **Perfil → Editar perfil → Configurações de privacidade → " +
  '"Detalhes de jogos": Público** (pode marcar "Sempre manter meu tempo de jogo total privado"). ' +
  "Depois mande /cadastrar de novo.";

export async function registrarComandos(rest: Rest, appId: string): Promise<void> {
  await rest.chamar("PUT", `/applications/${appId}/commands`, DEFINICOES);
}

export async function tratarInteracao(bruta: unknown, ctx: ContextoComandos): Promise<void> {
  const i = bruta as Interacao;
  if (i.type !== TIPO_COMANDO || !i.data) return;
  const autor = i.user?.id ?? i.member?.user.id;
  if (!autor) return;

  // Tudo é respondido em dois passos: "pensando..." na hora e o resultado depois
  // (o Discord exige resposta em até 3 s; consultar a Steam pode demorar mais).
  await ctx.rest.chamar("POST", `/interactions/${i.id}/${i.token}/callback`, { type: RESPOSTA.ADIADA });
  let texto: string;
  try {
    texto = await executar(i.data, autor, ctx);
  } catch (err) {
    ctx.log.error(`Comando /${i.data.name} falhou: ${mensagemDeErro(err)}`);
    texto = `❌ Não deu certo: ${mensagemDeErro(err)}`;
  }
  await ctx.rest.chamar("PATCH", `/webhooks/${ctx.appId}/${i.token}/messages/@original`, { content: texto });
}

async function executar(data: NonNullable<Interacao["data"]>, autor: string, ctx: ContextoComandos): Promise<string> {
  const valor = (nome: string, opcoes = data.options) => opcoes?.find((o) => o.name === nome)?.value;

  if (data.name === "cadastrar") return cadastrar(autor, String(valor("perfil") ?? ""), ctx);
  if (data.name === "usuarios") return autor === ctx.donoId ? listarUsuarios(ctx) : "Esse comando é só para o dono do bot.";

  const usuario = ctx.usuarios.buscar(autor);
  if (!usuario) return NAO_CADASTRADO;
  const destino = destinoDe(autor);

  if (data.name === "descadastrar") return descadastrar(autor, ctx);
  if (data.name === "verificar") {
    const r = await ctx.rodarCiclo();
    if (!r.ok) return `❌ A verificação falhou: ${r.resumo}`;
    const meu = r.porUsuario.get(autor);
    return meu ? `🔎 Verificação concluída: ${linhaDoUsuario(meu)}` : "🔎 Verificação concluída.";
  }
  if (data.name === "alvo") {
    const sub = data.options?.[0];
    const opcao = (nome: string) => valor(nome, sub?.options);
    const ehDono = autor === ctx.donoId;
    if (sub?.name === "definir") return definir(destino, String(opcao("jogo") ?? ""), Number(opcao("valor")), ctx);
    if (sub?.name === "remover") return remover(destino, ehDono, String(opcao("jogo") ?? ""), ctx);
    if (sub?.name === "listar") return listar(destino, ehDono, ctx);
  }
  return "Comando desconhecido.";
}

// ---------- cadastro ----------

async function cadastrar(autor: string, texto: string, ctx: ContextoComandos): Promise<string> {
  const jaCadastrado = ctx.usuarios.buscar(autor);
  if (!jaCadastrado && autor !== ctx.donoId && ctx.usuarios.listar().length >= ctx.usuarios.limite) {
    return "O bot atingiu o limite de pessoas cadastradas. Fale com quem te convidou.";
  }

  const perfil = await ctx.resolverPerfil(texto);
  let jogos: number;
  try {
    jogos = await ctx.contarWishlist(perfil.steamId);
  } catch (err) {
    if (err instanceof WishlistPrivadaError) return `Encontrei o perfil **${perfil.nome}**, mas ${COMO_LIBERAR_WISHLIST}`;
    throw err;
  }

  ctx.usuarios.salvar({ discordId: autor, steamId: perfil.steamId, nomeSteam: perfil.nome });
  const acao = jaCadastrado ? "Cadastro atualizado" : "Cadastro feito";
  return (
    `✅ ${acao}: perfil **${perfil.nome}**, com **${jogos} jogo(s)** na wishlist.\n` +
    "Vou te avisar aqui quando algum deles chegar perto do menor preço da história, " +
    "e também nas grandes promoções da Steam. A verificação é automática, a cada 2 horas.\n" +
    "• **/verificar**: verifica agora\n" +
    "• **/alvo definir**: aviso quando um jogo chegar no preço que você quer\n" +
    "• **/descadastrar**: para tudo e apaga seus dados\n" +
    "-# Guardo só seu ID do Discord, seu perfil da Steam e seus preços-alvo."
  );
}

function descadastrar(autor: string, ctx: ContextoComandos): string {
  ctx.usuarios.apagar(autor);
  const aviso =
    autor === ctx.donoId ? "\n-# Você é o dono: seu cadastro volta quando o bot reiniciar (vem do .env)." : "";
  return `Pronto: você não vai mais receber alertas, e seus dados foram apagados do bot.${aviso}`;
}

function listarUsuarios(ctx: ContextoComandos): string {
  const lista = ctx.usuarios.listar();
  if (lista.length === 0) return "Ninguém cadastrado.";
  const linhas = lista.map((u) => `• <@${u.discordId}> — Steam: **${u.nomeSteam ?? u.steamId}**`);
  return `**${lista.length} usuário(s)** (limite: ${ctx.usuarios.limite})\n${linhas.join("\n")}`;
}

// ---------- preço-alvo ----------

/** Link, número do app ou parte do nome de um jogo que o bot já conhece. */
function resolverAppid(texto: string, ctx: ContextoComandos): { appid: number } | { erro: string } {
  const appid = extrairAppid(texto);
  if (appid) return { appid };
  const achados = ctx.buscarPorNome(texto);
  if (achados.length === 1) return { appid: achados[0]!.appid };
  if (achados.length === 0) {
    return { erro: `Não achei "${texto}" entre os jogos que conheço. Use o link da loja (store.steampowered.com/app/...).` };
  }
  return { erro: `Achei mais de um jogo com "${texto}":\n${achados.map((j) => `• ${j.nome}`).join("\n")}\nSeja mais específico ou use o link da loja.` };
}

async function definir(destino: string, texto: string, valor: number, ctx: ContextoComandos): Promise<string> {
  const r = resolverAppid(texto, ctx);
  if ("erro" in r) return r.erro;
  if (!(valor > 0)) return "O valor precisa ser maior que zero.";

  const jogo = await ctx.buscarPreco(r.appid);
  if (!jogo) return `Não encontrei o app ${r.appid} na loja da Steam.`;

  const alvoCents = Math.round(valor * 100);
  ctx.alvos.definir(destino, { appid: r.appid, nome: jogo.nome, alvoCents });
  const hoje = jogo.finalCents === null ? "fora de venda hoje" : `hoje: ${brl(jogo.finalCents)}`;
  const jaChegou =
    jogo.finalCents !== null && jogo.finalCents <= alvoCents
      ? "\nEle já está nesse preço: o aviso chega na próxima verificação (ou use /verificar)."
      : "\nAviso quando chegar.";
  return `🎯 Alvo salvo: **${jogo.nome}** por até **${brl(alvoCents)}** (${hoje}).${jaChegou}`;
}

function remover(destino: string, ehDono: boolean, texto: string, ctx: ContextoComandos): string {
  const r = resolverAppid(texto, ctx);
  if ("erro" in r) return r.erro;
  const nome = ctx.alvos.doBanco(destino).find((a) => a.appid === r.appid)?.nome ?? `app ${r.appid}`;
  if (ctx.alvos.remover(destino, r.appid)) return `Alvo removido: **${nome}**.`;
  if (ehDono && ctx.alvos.doArquivo().has(r.appid)) {
    return "Esse alvo está no arquivo config/precos-alvo.json: remova por lá.";
  }
  return "Esse jogo não tem preço-alvo.";
}

function listar(destino: string, ehDono: boolean, ctx: ContextoComandos): string {
  const banco = ctx.alvos.doBanco(destino);
  const arquivo = ehDono ? [...ctx.alvos.doArquivo()].filter(([appid]) => !banco.some((a) => a.appid === appid)) : [];
  if (banco.length === 0 && arquivo.length === 0) return "Você ainda não tem preços-alvo. Use **/alvo definir**.";
  const linhas = [
    ...banco.map((a) => `🎯 **${a.nome}** — até ${brl(a.alvoCents)}`),
    ...arquivo.map(([appid, cents]) => `🎯 app ${appid} — até ${brl(cents)} *(arquivo)*`),
  ];
  return `**Seus preços-alvo**\n${linhas.join("\n")}`;
}
