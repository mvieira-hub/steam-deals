# Arquitetura e decisões

Este documento explica **como** o Steam Deals é organizado e, principalmente, **por que** cada escolha foi feita. A meta do projeto foi construir um serviço resiliente e fácil de manter com o mínimo de peças móveis.

## Visão geral

O bot roda um **ciclo** de tempos em tempos (e sob demanda, pelo `/verificar`). Cada ciclo:

1. lê a wishlist de cada usuário cadastrado (Steam);
2. junta todos os jogos e consulta **uma vez** os preços (Steam) e o menor preço histórico (ITAD);
3. aplica as regras puras para decidir o selo de cada oferta e se vale alertar;
4. enfileira os alertas novos (sem repetir) e os avisos de evento sazonal;
5. envia por DM no Discord, por usuário, com reenvio do que falhar.

```
Agendador / /verificar
        │
        ▼
     Ciclo ──► Steam (wishlists, preços)
        │  ──► IsThereAnyDeal (menor preço)   ──►  Regras (domain, puro)
        │  ──► Calendário de promoções               │
        │                                            ▼
        └──────────────────────────────────►  Fila (SQLite, dedupe) ──► DM no Discord
```

## Princípios

### 1. Núcleo puro, infraestrutura nas bordas (portas e adaptadores)

`src/domain/` não importa nada de rede nem de banco. São funções puras:

- `deal-evaluator.ts` — dado um preço, um desconto, o menor histórico e um alvo, devolve o **selo** e se deve **alertar**.
- `evento.ts` — dado um calendário e o instante atual, devolve a **fase** da promoção (véspera / início / último dia).
- `mensagens.ts` — monta título, texto e formato (cards ou lista) de cada aviso.
- `alerta.ts` — os tipos e a **porta de saída** `Notifier`.

Tudo o que fala com o mundo é um **adaptador**: `providers/steam`, `providers/itad`, `notifiers/discord`, `db`. O ciclo (`jobs/`) recebe essas dependências por parâmetro.

**Por quê:** a regra de negócio (o que é uma "oferta boa") é o coração do produto e é onde erros doem mais. Mantê-la pura permite testá-la inteira, de forma rápida e determinística, sem simular Steam, Discord ou relógio. Trocar de canal ou de fonte de preço vira trabalho de borda, sem tocar no núcleo.

### 2. Zero dependências de runtime

Não há `node_modules` em produção. O projeto usa só o que o Node 24 já traz:

| Precisa de | Usa |
|---|---|
| HTTP | `fetch` nativo |
| WebSocket (gateway do Discord) | `WebSocket` nativo |
| Banco | `node:sqlite` (`DatabaseSync`) |
| Testes | `node:test` + `node:assert` |
| TypeScript | execução direta pelo Node (type stripping); `tsc` só valida tipos |

**Por quê:** menos dependências = menos superfície de ataque, menos quebras em atualização, imagem menor e nada de "etapa de build". O custo é escrever um pouco mais de código (ex.: o cliente de gateway), assumido de propósito como exercício e como controle sobre o comportamento.

### 3. Resiliência: o ciclo nunca deixa o usuário no escuro

- **Fila outbox com deduplicação.** O alerta é gravado na tabela `notificacoes` com uma `chave` única (`appid:preço:data-fim`) **antes** de enviar, e marcado como enviado depois. Isso garante que a mesma oferta não é avisada duas vezes e que, se o Discord cair, o alerta fica pendente e é reenviado no ciclo seguinte (com limite de tentativas).
- **Cache do menor preço.** Se o ITAD estiver fora, o ciclo usa o último menor preço salvo no banco (`itad: "cache"`) em vez de falhar.
- **Isolamento por usuário.** Se a wishlist de uma pessoa estiver privada, ou a DM dela bloqueada, isso é registrado para ela e **não interrompe** os outros.
- **Falha de ciclo é registrada, não propagada.** `executarCiclo` nunca lança: grava a execução com `ok = 0` e segue vivo para a próxima.

### 4. Agendador que entende "máquina desligada"

O intervalo é contado a partir da **última execução bem-sucedida** gravada no banco, não de quando o processo subiu. Se o PC/servidor ficou horas fora, ao voltar o bot percebe que passou do intervalo e verifica **na hora**, em vez de esperar o ciclo inteiro.

### 5. Uma consulta de preços para todos

No modo multiusuário, o ciclo une os `appid` de todas as wishlists e faz **uma** rodada de consultas à Steam e ao ITAD, distribuindo os resultados por pessoa. Dez usuários não geram dez vezes mais chamadas — o que mantém o bot dentro dos limites das APIs e leve o bastante para uma VM gratuita de 1 GB.

## Dados (SQLite)

Esquema versionado por **migrações** (`src/db/migracoes.ts`); cada mudança é um item novo na lista, nunca uma edição de migração já aplicada. Todo o SQL fica em `src/db/repositorio.ts` — o resto do código não escreve SQL.

| Tabela | Papel |
|---|---|
| `usuarios` | quem recebe alertas (Discord ID → Steam ID) |
| `wishlist` | itens por usuário, com exclusão lógica |
| `precos` | histórico local: um registro **só quando o preço muda** |
| `menores` | cache do menor preço do ITAD (reserva se a API cair) |
| `notificacoes` | a fila outbox (dedupe + reenvio) |
| `precos_alvo` | preços-alvo definidos pelo `/alvo`, por usuário |
| `eventos_avisados` | qual fase de cada promoção já foi avisada, por usuário |
| `execucoes` | log de ciclos (base do agendador e do diagnóstico) |

Backup com `VACUUM INTO` (`src/backup.ts`) gera uma cópia consistente num arquivo só, mesmo com o bot rodando.

## Integrações externas

- **Steam** — wishlist (`IWishlistService`), preços em lote (`IStoreBrowseService`) e resolução de perfil pelo XML público da comunidade. **Sem API key** para perfis/lojas públicos. A wishlist segue a privacidade "Detalhes de jogos".
- **IsThereAnyDeal** — menor preço histórico (na Steam e em outras lojas). Chave gratuita.
- **Discord** — envio por DM pela **API REST**; os comandos chegam por uma conexão de **gateway (WebSocket)** própria. Tudo com um cliente REST comum (`src/discord/rest.ts`) que trata rate limit e erros.

## O que ficou de fora de propósito

- **Framework de bot (discord.js etc.)** — o escopo (enviar DM + poucos comandos) não justifica a dependência; o gateway próprio cobre o necessário.
- **ORM** — o SQL é pequeno e fica isolado no repositório; um ORM só adicionaria peso.
- **Etapa de build / bundler** — desnecessária com a execução direta de TypeScript no Node 24.

## Limites conhecidos

- Depende de endpoints públicos da Steam que não são contrato estável (podem mudar).
- O calendário de promoções é mantido à mão (a Valve não publica um feed).
- Numa VM gratuita, a escala é de dezenas de usuários; abrir ao público pediria controle de ritmo mais fino e atenção a dados pessoais (LGPD).
