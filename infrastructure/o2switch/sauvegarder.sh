#!/usr/bin/env bash
#
# Sauvegarde de la base AfriKaisse Cloud : copie compressée, gardée 14 jours.
# Tâche Cron cPanel quotidienne :   bash ~/afrikaisse/sauvegarder.sh
# Lancée aussi par DEPOSER-AFRIKAISSE.sh avant chaque mise à jour.
#
set -euo pipefail

APP="$HOME/afrikaisse"
DOSSIER="$HOME/sauvegardes-afrikaisse"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump est introuvable sur cet hébergement."
  exit 1
fi
URL="$(grep '^AFK_DB=' "$APP/.env" | head -1 | cut -d= -f2-)"
if [ -z "$URL" ]; then
  echo "AFK_DB absent de $APP/.env"
  exit 1
fi

mkdir -p "$DOSSIER"
chmod 700 "$DOSSIER"
FICHIER="$DOSSIER/afrikaisse-$(date +%Y%m%d-%H%M%S).sql.gz"
# Écrit à côté puis renommé : une copie interrompue ne passe jamais pour une bonne.
pg_dump --no-owner --no-privileges --dbname="$URL" | gzip > "$FICHIER.partiel"
mv "$FICHIER.partiel" "$FICHIER"
find "$DOSSIER" -name 'afrikaisse-*.sql.gz' -mtime +14 -delete
echo "  sauvegarde : $FICHIER ($(du -h "$FICHIER" | cut -f1))"
