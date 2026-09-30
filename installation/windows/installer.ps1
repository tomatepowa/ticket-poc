<#
.SYNOPSIS
  Installe (ou met a jour) le portail tickets comme service Windows.

.DESCRIPTION
  A lancer dans une console PowerShell "en tant qu'administrateur", depuis le
  dossier du portail (celui qui contient package.json), par exemple :
    cd C:\PortailTickets
    .\installation\windows\installer.ps1 -WinSW C:\Telechargements\WinSW-x64.exe

  Etapes : verifications -> dependances (npm ci) -> build du front -> suppression
  des outils de build -> service Windows (WinSW) -> demarrage.
  Relance sur une installation existante = mise a jour (service arrete puis relance).

  Prerequis et procedure complete : installation\windows\INSTALLATION.md

.PARAMETER WinSW
  Chemin de l'executable WinSW (WinSW-x64.exe, https://github.com/winsw/winsw/releases).
  Inutile si PortailTickets.exe est deja present a la racine du portail.

.PARAMETER OuvrirPareFeu
  Ajoute une regle de pare-feu entrante pour le port du portail.

.PARAMETER HorsLigne
  Serveur sans acces au registre npm : le dossier a ete prepare sur un autre
  poste (npm ci, npm run build, npm prune --omit=dev) et copie avec node_modules
  et dist. Le script ne fait alors que le service Windows.
#>
param(
  [string]$WinSW,
  [switch]$OuvrirPareFeu,
  [switch]$HorsLigne
)

$ErrorActionPreference = "Stop"
$racine = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $racine
$serviceExe = Join-Path $racine "PortailTickets.exe"
$serviceXml = Join-Path $racine "PortailTickets.xml"

function Etape($texte) { Write-Host "`n==> $texte" -ForegroundColor Cyan }
function Echec($texte) { Write-Host "ERREUR : $texte" -ForegroundColor Red; exit 1 }

# ---------- Verifications ----------
Etape "Verifications"
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Echec "lancer PowerShell en tant qu'administrateur." }
if (-not (Test-Path (Join-Path $racine "package.json"))) { Echec "package.json introuvable dans $racine." }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Echec "Node.js introuvable. Installer Node.js LTS (20 ou 22) : https://nodejs.org" }
$versionNode = [int]((node -v).TrimStart("v").Split(".")[0])
if ($versionNode -lt 20) { Echec "Node.js $(node -v) trop ancien : version 20 ou plus requise." }
Write-Host "Node.js $(node -v), npm $(npm -v)"

if (-not (Test-Path $serviceExe)) {
  if (-not $WinSW -or -not (Test-Path $WinSW)) { Echec "indiquer l'executable WinSW : -WinSW <chemin>\WinSW-x64.exe" }
  Copy-Item $WinSW $serviceExe
}

if (-not (Test-Path $serviceXml)) {
  Copy-Item (Join-Path $PSScriptRoot "PortailTickets.xml.modele") $serviceXml
  Write-Host "PortailTickets.xml cree a partir du modele : completer les valeurs A_COMPLETER, puis relancer ce script." -ForegroundColor Yellow
  exit 0
}
if ((Get-Content $serviceXml -Raw) -match "A_COMPLETER") {
  Echec "PortailTickets.xml contient encore des valeurs A_COMPLETER."
}
# Le fichier contient des secrets : lecture reservee aux administrateurs et a SYSTEM.
icacls $serviceXml /inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:R" | Out-Null

# ---------- Arret du service (mise a jour) ----------
$service = Get-Service -Name "PortailTickets" -ErrorAction SilentlyContinue
if ($service -and $service.Status -eq "Running") {
  Etape "Arret du service existant (mise a jour)"
  Stop-Service PortailTickets
}

# ---------- Dependances et build ----------
if ($HorsLigne) {
  Etape "Installation hors ligne : dependances et build deja prepares"
  foreach ($d in "node_modules", "dist") {
    if (-not (Test-Path (Join-Path $racine $d))) { Echec "$d absent : preparer le dossier sur un poste connecte (voir INSTALLATION.md)." }
  }
} else {
Etape "Installation des dependances (npm ci)"
# better-sqlite3 (dependance optionnelle, uniquement pour la demo) peut echouer sans consequence.
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Echec "npm ci en echec (acces au registre npm / proxy ?)." }

Etape "Construction du front (npm run build)"
npm run build
if ($LASTEXITCODE -ne 0) { Echec "build du front en echec." }

Etape "Suppression des outils de build (npm prune --omit=dev)"
npm prune --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Echec "npm prune en echec." }
}

New-Item -ItemType Directory -Force (Join-Path $racine "journaux") | Out-Null

# ---------- Service Windows ----------
if (-not $service) {
  Etape "Creation du service Windows PortailTickets"
  & $serviceExe install
  if ($LASTEXITCODE -ne 0) { Echec "creation du service en echec." }
} else {
  Etape "Mise a jour de la configuration du service"
  & $serviceExe refresh
}

if ($OuvrirPareFeu) {
  $port = ([xml](Get-Content $serviceXml)).service.env | Where-Object { $_.name -eq "PORT" } | ForEach-Object { $_.value }
  if (-not (Get-NetFirewallRule -DisplayName "Portail tickets" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "Portail tickets" -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow | Out-Null
    Write-Host "Pare-feu : port $port ouvert en entree."
  }
}

Etape "Demarrage du service"
Start-Service PortailTickets
Start-Sleep 5
$service = Get-Service PortailTickets
Write-Host "Service PortailTickets : $($service.Status)"
if ($service.Status -ne "Running") { Echec "le service ne tourne pas : voir $racine\journaux" }
Write-Host "Journaux : $racine\journaux" -ForegroundColor Green
