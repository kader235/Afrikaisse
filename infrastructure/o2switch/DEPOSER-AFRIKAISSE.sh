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
# Si cPanel refuse de créer la base tout seul, la créer à la main (le script explique comment), puis :
#   bash ~/DEPOSER-AFRIKAISSE.sh base        (le mot de passe est demandé, sans s'afficher)
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

MDP_MANUEL=""
if [ "${1:-}" = "base" ]; then
  read -rsp "Mot de passe de l'utilisateur de la base (il ne s'affiche pas) : " MDP_MANUEL
  echo
  if [ -z "$MDP_MANUEL" ]; then
    echo "Mot de passe vide : rien n'a été fait."
    exit 1
  fi
fi

# Appel cPanel qui échoue bruyamment : uapi répond 0 même quand il refuse.
uapi_ok() {
  local reponse
  reponse="$(uapi --output=json "$@" 2>&1 || true)"
  case "$reponse" in
    *'"status":1'*) return 0 ;;
  esac
  echo "cPanel a refusé : uapi $*" | sed 's/password=[^ ]*/password=***/'
  printf '%s\n' "$reponse" | grep -o '"errors":\[[^]]*\]' | head -c 300 || true
  echo
  return 1
}

creer_base() {
  local bases utilisateurs
  bases="$(uapi --output=json Postgresql list_databases 2>&1 || true)"
  case "$bases" in
    *"\"$BASE\""*) echo "  base $BASE déjà créée" ;;
    *) uapi_ok Postgresql create_database name="$BASE" || return 1; echo "  base $BASE créée" ;;
  esac
  utilisateurs="$(uapi --output=json Postgresql list_users 2>&1 || true)"
  case "$utilisateurs" in
    *"\"$UTILISATEUR\""*) uapi_ok Postgresql set_password user="$UTILISATEUR" password="$MDP" || return 1; echo "  utilisateur $UTILISATEUR : nouveau mot de passe" ;;
    *) uapi_ok Postgresql create_user name="$UTILISATEUR" password="$MDP" || return 1; echo "  utilisateur $UTILISATEUR créé" ;;
  esac
  uapi_ok Postgresql grant_all_privileges user="$UTILISATEUR" database="$BASE" || return 1
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
  # cPanel refuse un utilisateur du même nom que la base.
  UTILISATEUR="$(whoami)_afk"
  if [ -n "$MDP_MANUEL" ]; then
    MDP="$MDP_MANUEL"
    echo "  base créée à la main : $BASE, utilisateur $UTILISATEUR"
  else
    MDP="$(openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | head -c 32)"
    if ! creer_base; then
      echo
      echo "cPanel n'accepte pas la création automatique. Faites-la à la main, une seule fois :"
      echo "  1. cPanel > Bases de données PostgreSQL > Créer une base : afrikaisse"
      echo "     (cPanel la nomme $BASE)"
      echo "  2. Même page > Ajouter un utilisateur : afk, avec un mot de passe solide"
      echo "     (cPanel le nomme $UTILISATEUR). Notez ce mot de passe."
      echo "  3. Même page > Ajouter l'utilisateur à la base : $UTILISATEUR sur $BASE, tous les privilèges"
      echo "  4. Terminal :  bash ~/DEPOSER-AFRIKAISSE.sh base"
      echo "     puis tapez le mot de passe de l'étape 2."
      exit 1
    fi
  fi
  SECRET="$(openssl rand -base64 72 | tr -dc 'A-Za-z0-9' | head -c 64)"
  # Le mot de passe va dans une adresse postgres:// : ses caractères spéciaux doivent être encodés.
  MDP_URL="$("$NODE" -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$MDP")"

  umask 077
  cat > "$APP/.env" <<FIN
AFK_PROFILE=cloud
AFK_DB=postgres://${UTILISATEUR}:${MDP_URL}@localhost/${BASE}
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
  echo "La base n'a pas pu être mise à jour."
  if [ "$PREMIERE_FOIS" = "1" ]; then
    echo "Première installation : vérifiez le mot de passe et que l'utilisateur est bien ajouté à la base,"
    echo "puis effacez le réglage raté et recommencez :"
    echo "  rm ~/afrikaisse/.env && bash ~/DEPOSER-AFRIKAISSE.sh base"
  fi
  echo "Envoyez une photo de cet écran."
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
        echo "Journal :  tail -50 ~/afrikaisse/stderr.log"
        echo "Envoyez une photo de cet écran et de ce journal."
        ;;
    esac
    echo "L'archive est laissée en place pour relancer :  bash ~/DEPOSER-AFRIKAISSE.sh"
    exit 1
    ;;
esac
