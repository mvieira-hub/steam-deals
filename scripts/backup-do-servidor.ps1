# Puxa o backup do banco do servidor Oracle para este PC, guardando as últimas cópias.
# Roda sozinho pelo Agendador de Tarefas do Windows (ver docs/servidor-24-7.md).
# Rodar na mão: botão direito no arquivo > "Executar com o PowerShell".

$ErrorActionPreference = "Stop"

$ip      = "152.67.58.130"
$chave   = "$HOME\.ssh\oracle-steam-deals"
$remoto  = "ubuntu@${ip}:~/steam-deals/data/steam-deals-backup.db"
$pasta   = "$HOME\Documents\GitHub\steam-deals\backups"
$manter  = 14   # quantas cópias diárias guardar

New-Item -ItemType Directory -Force -Path $pasta | Out-Null
$destino = Join-Path $pasta ("steam-deals-{0}.db" -f (Get-Date -Format "yyyy-MM-dd"))

# 1. O servidor gera um backup fresco; 2. o PC copia.
& "$env:WINDIR\System32\OpenSSH\ssh.exe" -i $chave -o BatchMode=yes -o ConnectTimeout=30 ubuntu@$ip `
  "cd ~/steam-deals && docker compose -f docker-compose.prod.yml exec -T bot node src/backup.ts" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar o backup no servidor (código $LASTEXITCODE)." }

& "$env:WINDIR\System32\OpenSSH\scp.exe" -i $chave -o BatchMode=yes -o ConnectTimeout=30 $remoto $destino
if ($LASTEXITCODE -ne 0) { throw "Falha ao copiar o backup (código $LASTEXITCODE)." }

# Apaga as cópias mais antigas, mantendo as últimas $manter.
Get-ChildItem $pasta -Filter "steam-deals-*.db" |
  Sort-Object Name -Descending | Select-Object -Skip $manter | Remove-Item -Force

$kb = [math]::Round((Get-Item $destino).Length / 1KB)
Write-Host ("Backup salvo: {0} ({1} KB)" -f $destino, $kb)
