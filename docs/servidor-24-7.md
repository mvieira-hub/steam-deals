# Servidor 24/7 na Oracle Cloud (gratuito, São Paulo)

Leva o bot do seu PC para uma VM gratuita da Oracle Cloud, que fica ligada o tempo todo. Tempo: ~40 minutos.

**O que você vai precisar:** um cartão de crédito (a Oracle só faz uma verificação; recursos "Always Free" não são cobrados), o PC com este projeto e acesso ao GitHub.

**O que é gratuito ("Always Free"):** VM `VM.Standard.E2.1.Micro` (1 GB de RAM, sobra para os ~35 MB do bot), **IP público incluso**, 10 TB de tráfego por mês e até 200 GB de disco. Fonte: [Oracle, recursos Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

> ⚠️ **Nunca deixe o bot ligado no PC e no servidor ao mesmo tempo.** Os alertas chegariam em dobro e os comandos `/verificar` e `/alvo` seriam atendidos duas vezes. O passo 7 desliga o do PC antes de ligar o do servidor.

---

## 1. Criar a conta (com São Paulo como região principal)

1. Acesse [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) → **Start for free**.
2. Preencha os dados. Em **Home Region**, escolha **Brazil East (Sao Paulo)**.
   **Atenção: a região principal não pode ser trocada depois**, e os recursos gratuitos só existem nela.
3. Faça a verificação do cartão e aguarde o e-mail de conta pronta (pode levar alguns minutos).

## 2. (Recomendado) Proteger contra recuperação e cobranças

A Oracle pode **recuperar VMs "Always Free" ociosas**: se, em 7 dias, a CPU ficar abaixo de 20% (95º percentil) e a rede abaixo de 20%. O bot passa quase o tempo todo esperando, então pode se encaixar nisso.

- **Converter a conta para "Pay As You Go"**: é o caminho mais citado para evitar a recuperação; os recursos Always Free continuam sem custo. A documentação da Oracle não confirma explicitamente essa isenção, por isso o passo 9 também deixa um **backup automático diário**.
  Menu ☰ → **Billing & Cost Management** → **Upgrade and Manage Payment** → **Upgrade to Pay As You Go**.
  **Não há como voltar** para a conta só gratuita depois. A partir daí, qualquer recurso que **não** seja Always Free é cobrado no cartão — por isso o alerta de orçamento abaixo. Se preferir não converter, o bot funciona igual; o risco é só a VM ser recuperada e você recriá-la com o backup.
- **Se converter, crie um alerta de orçamento** para ser avisado de qualquer centavo: Menu ☰ → **Billing & Cost Management** → **Budgets** → **Create Budget** → valor **1** (na moeda da conta) → alerta por e-mail em **1%**.

## 3. Criar a VM

1. Menu ☰ → **Compute** → **Instances** → **Create instance**.
2. **Name:** `steam-deals`.
3. **Image and shape** → **Edit**:
   - **Image:** **Change image** → **Ubuntu** → **Canonical Ubuntu 24.04** (não a "Minimal").
   - **Shape:** **Change shape** → **Virtual machine** → **Specialty and previous generation** → **VM.Standard.E2.1.Micro**. Tem que aparecer a etiqueta **Always Free-eligible**.
4. **Networking:** deixe criar uma **nova VCN** com **sub-rede pública** e marque **Assign a public IPv4 address**.
5. **Add SSH keys:** **Generate a key pair for me** → **Save private key**. Guarde o arquivo baixado (é a chave para entrar no servidor).
6. **Boot volume:** pode deixar o padrão (~47 GB, dentro dos 200 GB gratuitos).
7. **Create**. Em ~1 minuto o estado fica **Running**. Anote o **Public IP address** da página da instância.

> Se aparecer **"Out of host capacity"**, faltou VM gratuita em São Paulo naquele momento. Tente de novo mais tarde.

## 4. Conectar do seu PC

No **PowerShell** do Windows (o cliente SSH já vem com o Windows 11). Troque `Downloads\ssh-key-*.key` pelo arquivo que você baixou e `IP_DO_SERVIDOR` pelo IP anotado.

```powershell
mkdir $HOME\.ssh -Force
move $HOME\Downloads\ssh-key-*.key $HOME\.ssh\oracle-steam-deals.key
# O SSH recusa chave que outros usuários do Windows possam ler:
icacls $HOME\.ssh\oracle-steam-deals.key /inheritance:r /grant:r "$($env:USERNAME):(R)"
ssh -i $HOME\.ssh\oracle-steam-deals.key ubuntu@IP_DO_SERVIDOR
```

Na primeira vez ele pergunta se confia no servidor: responda `yes`. O prompt muda para `ubuntu@steam-deals:~$` — você está no servidor. **Os passos 5 e 6 são digitados aí.**

## 5. Preparar o servidor

```bash
# 2 GB de swap: folga para a VM de 1 GB de RAM
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Docker (script oficial). Ele já inicia sozinho quando a VM liga.
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit
```

Conecte de novo (o mesmo `ssh -i ...` do passo 4) para valer a permissão do Docker, e confira:

```bash
docker run --rm hello-world
```

## 6. Baixar o código (chave de leitura do GitHub)

O repositório é privado. Em vez de colocar sua senha ou token do GitHub no servidor, crie uma **deploy key**: uma chave que só lê este repositório.

```bash
ssh-keygen -t ed25519 -C "steam-deals-servidor" -f ~/.ssh/github_steam_deals -N ""
cat ~/.ssh/github_steam_deals.pub
```

Copie a linha que aparece (começa com `ssh-ed25519`). No GitHub: repositório **steam-deals** → **Settings** → **Deploy keys** → **Add deploy key** → título `servidor Oracle`, cole a chave, **deixe "Allow write access" desmarcado** → **Add key**.

De volta ao servidor:

```bash
ssh-keyscan github.com >> ~/.ssh/known_hosts
GIT_SSH_COMMAND="ssh -i ~/.ssh/github_steam_deals" git clone git@github.com:mvieira-hub/steam-deals.git
cd steam-deals
git config core.sshCommand "ssh -i ~/.ssh/github_steam_deals"
mkdir -p data
```

> O servidor baixa o que está **no GitHub**. Se houver commits só no seu PC, envie-os antes (`git push`).

## 7. Levar a configuração e o histórico do PC

No **PowerShell do PC**, numa janela nova (deixe a do servidor aberta):

```powershell
cd C:\Users\Administrador\Documents\GitHub\steam-deals

# 1) Cópia do banco: alertas já enviados (para não repetir) e seus /alvo
docker compose exec bot node src/backup.ts

# 2) Desliga o bot do PC — a partir daqui, quem trabalha é o servidor
docker compose down

# 3) Envia o .env (tokens e chaves) e o banco direto para o servidor, sem passar pelo chat nem pelo git
scp -i $HOME\.ssh\oracle-steam-deals.key .env ubuntu@IP_DO_SERVIDOR:~/steam-deals/.env
scp -i $HOME\.ssh\oracle-steam-deals.key data\steam-deals-backup.db ubuntu@IP_DO_SERVIDOR:~/steam-deals/data/steam-deals.db
```

## 8. Ligar no servidor

No terminal do **servidor**:

```bash
cd ~/steam-deals
# Atalho: "bot <comando>" em vez de "docker compose -f ~/steam-deals/docker-compose.prod.yml <comando>"
echo "alias bot='docker compose -f ~/steam-deals/docker-compose.prod.yml'" >> ~/.bashrc && source ~/.bashrc

bot up -d --build
bot logs -f
```

Em alguns segundos o log deve mostrar:

```
Próximo evento no calendário: ...
Steam Deals no ar: verificando a cada 2h.
Comandos do Discord ativos (/verificar, /alvo).
```

(`Ctrl+C` sai do log; o bot continua rodando.) Agora mande **`/verificar`** na DM do bot: a resposta vem do servidor.

## 9. Backup automático diário

Ainda no servidor:

```bash
(crontab -l 2>/dev/null; echo "0 4 * * * docker compose -f /home/ubuntu/steam-deals/docker-compose.prod.yml exec -T bot node src/backup.ts >/dev/null 2>&1") | crontab -
```

Todo dia às 4h (horário do servidor) ele atualiza `data/steam-deals-backup.db`. De vez em quando, traga uma cópia para o PC:

```powershell
scp -i $HOME\.ssh\oracle-steam-deals.key ubuntu@IP_DO_SERVIDOR:~/steam-deals/data/steam-deals-backup.db C:\Users\Administrador\Documents\GitHub\steam-deals\data\
```

---

## Dia a dia (no servidor)

| Para… | Comando |
|---|---|
| Entrar no servidor (do PC) | `ssh -i $HOME\.ssh\oracle-steam-deals.key ubuntu@IP_DO_SERVIDOR` |
| Ver o log | `bot logs -f` |
| Atualizar o código | `cd ~/steam-deals && git pull && bot up -d --build` |
| Mudar uma opção do `.env` | `nano ~/steam-deals/.env` e depois `bot restart` |
| Editar o calendário | `nano ~/steam-deals/config/eventos-steam.json` e depois `bot restart` |
| Desligar / ligar | `bot down` / `bot up -d` |

Preços-alvo: prefira o **`/alvo`** no Discord (fica no banco do servidor). Se editar `config/precos-alvo.json` no servidor, o próximo `git pull` pode reclamar de alteração local.

## Voltar para o PC

```bash
# no servidor
bot exec bot node src/backup.ts && bot down
```

```powershell
# no PC
cd C:\Users\Administrador\Documents\GitHub\steam-deals
# Arquivos auxiliares do banco antigo do PC: não podem se misturar com o banco que vem do servidor
Remove-Item data\steam-deals.db-wal, data\steam-deals.db-shm -ErrorAction SilentlyContinue
scp -i $HOME\.ssh\oracle-steam-deals.key ubuntu@IP_DO_SERVIDOR:~/steam-deals/data/steam-deals-backup.db data\steam-deals.db
docker compose up -d
```

## Problemas comuns

| Sintoma | Solução |
|---|---|
| `Out of host capacity` ao criar a VM | Falta momentânea de VM gratuita em São Paulo: tente mais tarde |
| `WARNING: UNPROTECTED PRIVATE KEY FILE!` | Rode o `icacls` do passo 4 |
| `Permission denied (publickey)` no `ssh` | Usuário errado (é `ubuntu`) ou chave errada no `-i` |
| `permission denied ... docker.sock` | Saia e entre de novo no servidor depois do `usermod` (passo 5) |
| `Permission denied (publickey)` no `git clone` | A deploy key não foi adicionada no GitHub (passo 6) |
| Alertas ou respostas em dobro | O bot está ligado no PC e no servidor: `docker compose down` no PC |
| A VM sumiu ou foi parada pela Oracle | Recuperação por ociosidade (passo 2): crie outra VM e restaure o último backup |
