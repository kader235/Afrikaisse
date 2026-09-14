# Ouvre le pare-feu Windows au serveur AfriKaisse, pour les appareils du réseau local seulement.
# Appelé par l'installateur (déjà administrateur) ; -Retirer à la désinstallation.
#
# Règle par PROGRAMME et non par port : le serveur choisit son port parmi plusieurs candidats
# (ports réservés par Windows), une règle par port laisserait les tablettes dehors (leçon Scolaar).
# Tous profils réseau, mais « sous-réseau local » : le Wi-Fi d'un restaurant est souvent classé
# « Public » par Windows, et personne hors du réseau du restaurant ne peut entrer.
param(
  [string]$Programme,
  [switch]$Retirer
)

$nom = 'AfriKaisse (serveur du restaurant)'
try {
  Get-NetFirewallRule -DisplayName $nom -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
  if (-not $Retirer) {
    New-NetFirewallRule -DisplayName $nom -Direction Inbound -Action Allow -Program $Programme -RemoteAddress LocalSubnet -Profile Any `
      -Description 'Tablettes, téléphones et écrans cuisine du restaurant vers le serveur AfriKaisse.' | Out-Null
  }
} catch {
  # L'installation ne doit pas échouer pour autant : l'application marche sur le PC lui-même.
}
exit 0
