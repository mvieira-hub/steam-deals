# Imagem de produção: o código vai dentro da imagem (no desenvolvimento ele é montado da pasta).
# Sem dependências de runtime e sem etapa de build: o Node 24 executa o TypeScript direto.
FROM node:24-alpine

ENV NODE_ENV=production \
    TZ=America/Sao_Paulo

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY config ./config

# O banco fica em /app/data, montado como volume pelo docker-compose.prod.yml.
# Roda como root para gravar na pasta montada sem ajuste de permissão no servidor;
# o container não abre nenhuma porta (só faz chamadas de saída).
CMD ["node", "src/index.ts"]
