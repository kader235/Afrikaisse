#!/usr/bin/env bash
#
# Met AfriKaisse en ligne sur o2switch, et vérifie son propre travail.
#
# Avant la première fois, voir LISEZ-MOI.txt : sous-domaine créé, application Node créée
# dans « Setup Node.js App » (racine afrikaisse, fichier server.cjs, Node 24).
#
# À chaque mise en ligne :
#   1. Gestionnaire de fichiers : déposer afrikaisse.tar.gz et ce fichier dans le dossier personnel
#   2. Terminal cPanel :   bash ~/DEPOSER-AFRIKAISSE.sh
#
# Donner l'accès « Plateforme » (une fois, compte déjà créé sur le site) :
#   bash ~/DEPOSER-AFRIKAISSE.sh admin vous@exemple.td
#
# Le script s'arrête à la première erreur et dit laquelle. Il ne réécrit jamais le fichier .env
# existant : il contient le mot de passe de la base et le secret des sessions.
#
set -euo pipefail

ADRESSE="https://afrikaisse.dametta.com"
APP="$HOME/afrikaisse"
ARCHIVE="$HOME/afrikaisse.tar.gz"

NODE=""
for candidat in "$HOME"/nodevenv/afrikaisse/*/bin/node; do
  if [ -x "$candidat" ]; then NODE="$candidat"; fi
done
if [ -z "$NODE" ]; then
  echo "L'application Node « afrikaisse » n'existe pas encore."
  echo "cPanel > Setup Node.js App > Create Application (voir LISEZ-MOI.txt), puis recommencez."
  exit 1
fi
case "$("$NODE" -v)" in
  v2[2-9].*|v[3-9][0-9].*) ;;
  *) echo "Node $("$NODE" -v) : choisissez Node 24 dans Setup Node.js App."; exit 1 ;;
esac

if [ "${1:-}" = "admin" ]; then
  if [ -z "${2:-}" ]; then
    echo "Usage : bash ~/DEPOSER-AFRIKAISSE.sh admin vous@exemple.td"
    exit 1
  fi
  cd "$APP"
  "$NODE" cli.cjs grant-platform-admin "$2"
  exit 0
fi

# Appel cPanel qui échoue bruyamment : uapi répond 0 même quand il refuse.
uapi_ok() {
  local reponse
  reponse="$(uapi --output=json "$@" 2>&1 || true)"
  case "$reponse" in
    *'"status":1'*) return 0 ;;
  esac
  echo "cPanel a refusé : uapi $*" | sed 's/password=[^ ]*/password=***/'
  printf '%s\n' "$reponse" | grep -o '"errors":\[[^]]*\]' | head -1 || true
  return 1
}

echo "== Vérifications =="
if [ ! -f "$ARCHIVE" ]; then
  echo "MANQUE : $ARCHIVE"
  echo "Déposez afrikaisse.tar.gz dans le dossier personnel, puis recommencez."
  exit 1
fi
mkdir -p "$APP"
echo "  Node $("$NODE" -v), dossier $APP"
echo

PREMIERE_FOIS=0
echo "== Base de données et secrets =="
if [ -f "$APP/.env" ]; then
  echo "  .env déjà en place : secrets conservés"
else
  PREMIERE_FOIS=1
  BASE="$(whoami)_afrikaisse"
  MDP="$(openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | head -c 32)"
  SECRET="$(openssl rand -base64 72 | tr -dc 'A-Za-z0-9' | head -c 64)"

  BASES="$(uapi --output=json PostgresqlFE list_databases 2>&1 || true)"
  case "$BASES" in
    *"\"$BASE\""*) echo "  base $BASE déjà créée" ;;
    *) uapi_ok PostgresqlFE create_database name="$BASE"; echo "  base $BASE créée" ;;
  esac
  UTILISATEURS="$(uapi --output=json PostgresqlFE list_users 2>&1 || true)"
  case "$UTILISATEURS" in
    *"\"$BASE\""*) uapi_ok PostgresqlFE set_password user="$BASE" password="$MDP"; echo "  utilisateur $BASE : nouveau mot de passe" ;;
    *) uapi_ok PostgresqlFE create_user name="$BASE" password="$MDP"; echo "  utilisateur $BASE créé" ;;
  esac
  uapi_ok PostgresqlFE grant_all_privileges user="$BASE" database="$BASE"

  umask 077
  cat > "$APP/.env" <<FIN
AFK_PROFILE=cloud
AFK_DB=postgres://${BASE}:${MDP}@localhost/${BASE}
AFK_JWT_SECRET=${SECRET}
AFK_PUBLIC_URL=${ADRESSE}
AFK_WEB_DIR=${APP}/web
AFK_LOG_LEVEL=warn
FIN
  chmod 600 "$APP/.env"
  echo "  secrets écrits dans $APP/.env (à ne jamais partager)"
fi
echo

echo "== Sauvegarde avant mise à jour =="
if [ "$PREMIERE_FOIS" = "1" ]; then
  echo "  base neuve : rien à sauvegarder"
elif [ -f "$APP/sauvegarder.sh" ]; then
  if ! bash "$APP/sauvegarder.sh"; then
    echo "La sauvegarde a échoué : rien n'a été modifié. Envoyez une photo de cet écran."
    exit 1
  fi
else
  echo "  pas encore de script de sauvegarde (première version)"
fi
echo

echo "== Application =="
# web/ est remplacé en entier : ses fichiers changent de nom à chaque version.
if [ -d "$APP/web" ] && [ -f "$APP/web/index.html" ]; then
  rm -rf "$APP/web"
fi
tar -xzf "$ARCHIVE" -C "$APP"
for f in server.cjs cli.cjs VERSION sauvegarder.sh web/index.html web/menu.html; do
  if [ ! -f "$APP/$f" ]; then
    echo "Archive incomplète : $f manque. Reconstruisez le paquet."
    exit 1
  fi
done
ATTENDU="$(head -1 "$APP/VERSION")"
echo "  version $ATTENDU posée"
echo

echo "== Base =="
if ! (cd "$APP" && "$NODE" cli.cjs migrate); then
  echo "La base n'a pas pu être mise à jour. Envoyez une photo de cet écran."
  exit 1
fi
echo

echo "== Redémarrage et vérification =="
mkdir -p "$APP/tmp"
touch "$APP/tmp/restart.txt"
VU=""
for essai in 1 2 3 4 5 6 7 8 9 10 11 12; do
  sleep 5
  VU="$(curl -s -m 15 "$ADRESSE/api/health" || true)"
  case "$VU" in *"\"build\":\"$ATTENDU\""*) break ;; esac
done

case "$VU" in
  *"\"build\":\"$ATTENDU\""*)
    PAGE="$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$ADRESSE/" || true)"
    MENU="$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$ADRESSE/m/essai" || true)"
    echo "  API       : en ligne, version $ATTENDU"
    echo "  site      : $PAGE"
    echo "  menu QR   : $MENU"
    rm -f "$ARCHIVE"
    echo
    echo "Terminé. AfriKaisse est en ligne : $ADRESSE"
    ;;
  *)
    EN_HTTP="$(curl -s -m 15 "http://${ADRESSE#https://}/api/health" || true)"
    case "$EN_HTTP" in
      *"\"build\":\"$ATTENDU\""*)
        echo "L'application tourne, mais le certificat HTTPS n'est pas encore prêt."
        echo "cPanel > SSL/TLS Status > Run AutoSSL, attendez quelques minutes, puis relancez ce script."
        ;;
      *)
        echo "L'application ne répond pas avec la nouvelle version."
        echo "Réponse reçue : ${VU:-rien}"
        echo "Journal : tail -50 $APP/passenger.log"
        echo "Envoyez une photo de cet écran et de ce journal."
        ;;
    esac
    echo "L'archive est laissée en place pour relancer :  bash ~/DEPOSER-AFRIKAISSE.sh"
    exit 1
    ;;
esac
