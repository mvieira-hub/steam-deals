// Migrações do banco, em ordem. Migração que já rodou nunca é editada: mudança nova é item novo.
// steam_id e destino já ficam nas tabelas para o dia em que o bot atender amigos.

export const MIGRACOES: string[] = [
  /* 1 */ `
  CREATE TABLE jogos (
    appid         INTEGER PRIMARY KEY,
    nome          TEXT NOT NULL,
    atualizado_em TEXT NOT NULL
  );

  CREATE TABLE wishlist (
    steam_id      TEXT NOT NULL,
    appid         INTEGER NOT NULL,
    prioridade    INTEGER NOT NULL,
    adicionado_em TEXT NOT NULL,
    removido_em   TEXT,
    PRIMARY KEY (steam_id, appid)
  );

  -- Um registro só quando o preço muda: histórico local enxuto.
  CREATE TABLE precos (
    id             INTEGER PRIMARY KEY,
    appid          INTEGER NOT NULL,
    final_cents    INTEGER,
    original_cents INTEGER,
    discount_pct   INTEGER NOT NULL,
    termina_em     TEXT,
    capturado_em   TEXT NOT NULL
  );
  CREATE INDEX precos_appid ON precos (appid, id);

  -- Último menor preço obtido do ITAD: reserva para quando a API dele estiver fora.
  CREATE TABLE menores (
    appid             INTEGER PRIMARY KEY,
    steam_low_cents   INTEGER,
    steam_low_em      TEXT,
    outra_loja_cents  INTEGER,
    outra_loja_nome   TEXT,
    atualizado_em     TEXT NOT NULL
  );

  -- Fila de saída: o alerta é gravado antes de enviar e marcado depois.
  -- UNIQUE (destino, chave) é o que impede alerta repetido.
  CREATE TABLE notificacoes (
    id          INTEGER PRIMARY KEY,
    destino     TEXT NOT NULL,
    chave       TEXT NOT NULL,
    payload     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pendente', -- pendente | enviado | falhou
    tentativas  INTEGER NOT NULL DEFAULT 0,
    erro        TEXT,
    criado_em   TEXT NOT NULL,
    enviado_em  TEXT,
    UNIQUE (destino, chave)
  );

  CREATE TABLE execucoes (
    id           INTEGER PRIMARY KEY,
    iniciada_em  TEXT NOT NULL,
    terminada_em TEXT,
    ok           INTEGER,
    resumo       TEXT
  );
  `,

  /* 2 */ `
  -- Cada fase de um evento (lembrete, início, último dia) é avisada uma vez por destino.
  CREATE TABLE eventos_avisados (
    destino    TEXT NOT NULL,
    evento_id  TEXT NOT NULL,
    fase       TEXT NOT NULL,
    enviado_em TEXT NOT NULL,
    PRIMARY KEY (destino, evento_id, fase)
  );
  `,

  /* 3 */ `
  -- Preços-alvo definidos pelo Discord (/alvo). Somam-se aos do arquivo config/precos-alvo.json.
  CREATE TABLE precos_alvo (
    destino    TEXT NOT NULL,
    appid      INTEGER NOT NULL,
    nome       TEXT NOT NULL,
    alvo_cents INTEGER NOT NULL,
    criado_em  TEXT NOT NULL,
    PRIMARY KEY (destino, appid)
  );
  `,
];
