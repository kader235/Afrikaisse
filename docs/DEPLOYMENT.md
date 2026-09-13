# AfriKaisse — Déploiement

## 0. Développement

```bash
npm install
npm run verify        # types + tests (SQLite et PostgreSQL) + bundle API + build web
npm run dev:api       # API sur 127.0.0.1:4300 (AFK_PORT pour changer)
npm run dev:web       # Web sur http://localhost:5173 (AFK_API_URL si l'API n'est pas sur 4300)
```

Variables (fichier `services/api/.env`, jamais commité) :

| Variable | Défaut | Rôle |
|---|---|---|
| `AFK_PROFILE` | `cloud` | `cloud` ou `local` |
| `AFK_DB` | `sqlite:.data/afrikaisse.sqlite` | `postgres://…` ou `sqlite:chemin` |
| `AFK_PORT` / `PORT` | 4300 | Ignoré sous Passenger |
| `AFK_HOST` | `127.0.0.1` (cloud), `0.0.0.0` (local) | Adresse d'écoute |
| `AFK_JWT_SECRET` | généré et gardé en base | ≥ 32 caractères |
| `AFK_CORS_ORIGINS` | vide (fermé) | Origines autorisées, séparées par des virgules |
| `AFK_COOKIE_SECURE` | `true` en cloud | Cookie `Secure` |
| `AFK_TRUST_PROXY` | `true` en cloud | IP réelle derrière LiteSpeed |
| `AFK_AUTO_MIGRATE` | `true` | Migrations au démarrage |
| `AFK_LOG_LEVEL` | `info` | Niveau des journaux |

## 1. o2switch — d'abord la sonde (une fois)

Avant la phase 5, il faut mesurer ce que la documentation ne dit pas (ARCHITECTURE.md §3).

```bash
node infrastructure/o2switch/sonde/build.mjs
```

Puis, dans cPanel :
1. **Domaines** : créer `sonde.<domaine>`.
2. **Bases de données PostgreSQL** : créer une base et un utilisateur de test (ou réutiliser ceux
   d'AfriKaisse).
3. **Setup Node.js App** → *Create Application* : Node **24**, racine `afk-sonde`, URL `sonde.<domaine>`,
   fichier de démarrage `sonde.cjs`. Variables : `DATABASE_URL=postgres://user:pass@localhost/base`,
   `SONDE_TOKEN=<une chaîne au hasard>`.
4. Gestionnaire de fichiers : déposer `infrastructure/o2switch/sonde/dist/sonde.cjs` dans `~/afk-sonde/`,
   puis *Restart* dans Setup Node.js App.
5. Ouvrir `https://sonde.<domaine>/?t=<SONDE_TOKEN>`, cliquer **Tout tester**, attendre ~3 min,
   **Copier le rapport** et le transmettre.
6. **Supprimer l'application et le sous-domaine** ensuite.

## 2. o2switch — API AfriKaisse

```bash
npm run build:api     # → services/api/dist/server.cjs et cli.cjs (aucune dépendance à installer)
npm run build:web     # → apps/web/dist/
```

1. **Base** (Terminal cPanel) :
   ```bash
   CPUSER=$(whoami); DB="${CPUSER}_afrikaisse"
   PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)
   uapi PostgresqlFE create_database name="$DB"
   uapi PostgresqlFE create_user name="$DB" password="$PASS"
   uapi PostgresqlFE grant_all_privileges user="$DB" database="$DB"
   echo "AFK_DB=postgres://${DB}:${PASS}@localhost/${DB}"
   ```
2. **Setup Node.js App** : Node 24, racine `afrikaisse-api`, URL `app.<domaine>/api` (ou
   `api.<domaine>`), fichier `server.cjs`. Variables : `AFK_PROFILE=cloud`, `AFK_DB=…`,
   `AFK_JWT_SECRET=<48 caractères aléatoires>`, `AFK_CORS_ORIGINS=https://app.<domaine>`
   (seulement si le Web et l'API ont des origines différentes).
3. Déposer `server.cjs` et `cli.cjs` dans `~/afrikaisse-api/`, puis *Restart*. Les migrations
   s'appliquent au démarrage.
4. Web : déposer le contenu de `apps/web/dist/` dans le dossier du sous-domaine `app.<domaine>`.
   **Recommandé : même origine** (Web sur `app.<domaine>`, API sur `app.<domaine>/api`). Le cookie
   de renouvellement reste alors `SameSite=Strict`, sans CORS.
5. Vérifier : `https://app.<domaine>/api/health` → `{"status":"ok","profile":"cloud",…}`.
6. Donner l'accès back-office (Terminal, environnement Node activé) :
   ```bash
   cd ~/afrikaisse-api && node cli.cjs grant-platform-admin vous@globaltech.td
   ```

Mise à jour : redéposer `server.cjs`, puis *Restart* (ou `touch tmp/restart.txt`).

## 3. Sauvegardes Cloud

Cron cPanel quotidien :
`pg_dump` compressé dans `~/sauvegardes/`, rotation 14 jours, plus une copie hebdomadaire hors
o2switch. Script livré avec la phase 18. Tester la restauration au moins une fois par trimestre.

## 4. Serveur local Windows

Voir LOCAL.md. Installateur Inno Setup en phases 11 et 16.

## 5. Application tablette Android

Prérequis sur le poste de build : SDK Android (`%LOCALAPPDATA%\Android\Sdk`), **JDK 21**
(Capacitor 8 ; le JDK d'Android Studio convient et le script le trouve seul), Python + Pillow pour
régénérer les icônes.

```bash
node apps/tablet/scripts/apk.mjs
```

Le script construit le web, copie les écrans dans le projet Android (`cap sync`), lance Gradle et
dépose `apps/tablet/dist/AfriKaisse-tablette-debug.apk`. `VITE_AFK_CLOUD_URL` change l'adresse
du Cloud proposée par défaut.

C'est un APK **de test** (signé avec la clé de débogage). La version distribuée aux restaurants
exigera une clé de signature de publication, conservée hors du dépôt : à créer au moment de la
diffusion.

## Limites d'un mutualisé

Suffisant pour les premiers dizaines de restaurants. L'architecture n'a **aucune dépendance propre à
o2switch** (Node + PostgreSQL standard, fichier unique) : passer à un VPS se fait en changeant
d'hébergeur, sans toucher au code.
