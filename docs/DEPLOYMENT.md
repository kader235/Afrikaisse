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
| `AFK_PUBLIC_URL` | origine de l'écran, sinon `https://app.afrikaisse.com` | Adresse écrite dans les QR des tables (`<adresse>/m/<jeton>`). **À régler en production** : un QR imprimé ne change plus |
| `AFK_COOKIE_SECURE` | `true` en cloud | Cookie `Secure` |
| `AFK_TRUST_PROXY` | `true` en cloud | IP réelle derrière LiteSpeed |
| `AFK_AUTO_MIGRATE` | `true` | Migrations au démarrage |
| `AFK_LOG_LEVEL` | `info` | Niveau des journaux |
| `AFK_LOG_DIR` | vide (sortie standard) | Serveur local : un fichier par catégorie (`application`, `security`, `sync`, `printer`, `database`, `system`), rotation 2 Mo ou changement de jour, 7 archives, 30 jours au plus. Le lanceur Windows le fixe à `C:\ProgramData\AfriKaisse\journaux`. Ignoré dans le Cloud |
| `AFK_RELEASE_PUBLIC_KEY` | clé embarquée à la construction | Clé publique Ed25519 (SPKI DER en base64) qui vérifie les annonces de version. **À définir au moment de `npm run build:api`** pour l'embarquer dans `server.cjs` |
| `AFK_RELEASE_PRIVATE_KEY` | — | Clé privée (PKCS#8 DER en base64). Lue **uniquement** par `cli release-sign` / `release-publish`, jamais par le serveur web. Ne jamais la committer ni la laisser dans un `.env` de production |
| `AFK_UPDATE_URL` | Cloud relié, sinon `DEFAULT_CLOUD_URL` | Serveur local : adresse interrogée pour les mises à jour |
| `AFK_UPDATE_CHANNEL` | `stable` | `stable` ou `beta` |

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

## 2. o2switch — mise en ligne

Adresse retenue : **https://afrikaisse.dametta.com**. Elle est définie à deux endroits : la constante
`DEFAULT_CLOUD_URL` de `packages/core/src/network.ts` et la variable `ADRESSE` du script de dépôt. Une
seule application Node sert à la fois l'API et les écrans : même origine, pas de CORS, aucune règle
Apache à écrire.

Construire le paquet sur ce poste :

```bash
node infrastructure/o2switch/build.mjs
```

Le résultat va dans `infrastructure/o2switch/sortie/`, avec une copie sur le Bureau : `afrikaisse.tar.gz`,
`DEPOSER-AFRIKAISSE.sh` et `LISEZ-MOI.txt`. Les gestes cPanel sont dans LISEZ-MOI.txt. Le script de dépôt
fait le reste :

| Étape | Détail |
|---|---|
| Première fois | Crée la base PostgreSQL et son utilisateur (`uapi Postgresql`, ou à la main dans cPanel si le module est refusé : `bash ~/DEPOSER-AFRIKAISSE.sh base`), écrit `~/afrikaisse/.env` : mot de passe et secret JWT générés sur place, `chmod 600`. Un `.env` existant n'est jamais réécrit |
| Sauvegarde | `sauvegarder.sh` avant toute migration d'une base existante (pg_dump compressé, 14 jours) |
| Code | Remplace `web/`, pose `server.cjs`, `cli.cjs`, `VERSION` |
| Base | `node cli.cjs migrate` : une erreur arrête tout |
| Redémarrage | `touch tmp/restart.txt`, puis attend que `/api/health` renvoie le nouveau `build` |

Sous Passenger, Fastify ne démarre pas avec `listen({ path: 'passenger' })` (EADDRINUSE, fastify#5407) :
`main.ts` prépare l'application, puis appelle `app.server.listen('passenger')`.

Accès back-office : `bash ~/DEPOSER-AFRIKAISSE.sh admin vous@exemple.td`. Le compte doit déjà exister
(créé depuis le site).

## 3. Sauvegardes Cloud

Tâche Cron cPanel quotidienne : `bash ~/afrikaisse/sauvegarder.sh`. Les copies vont dans
`~/sauvegardes-afrikaisse/` et sont gardées 14 jours. Tester une restauration une fois par trimestre, sur
une base de test : `gunzip -c fichier.sql.gz | psql "<adresse de la base de test>"`.


## 4. Serveur local Windows

Voir LOCAL.md et DESKTOP.md. Installateur Inno Setup en phases 11 et 16 ; construction : §4.3.

### 4.1 Publier une nouvelle version du serveur local (§73)

Une seule fois : créer la paire de clés et ranger la clé privée hors du dépôt (coffre de mots de passe).

```bash
node services/api/dist/cli.cjs release-keygen
```

À chaque version :

1. **Construire avec la clé publique** : `AFK_RELEASE_PUBLIC_KEY=<clé publique> node infrastructure/windows/build.mjs`
   (la même variable pour `node infrastructure/o2switch/build.mjs`, afin que `cli release-publish` du
   Cloud vérifie les annonces). Sans elle, les serveurs locaux affichent « Vérification impossible ».
2. Déposer `AfriKaisse-Setup-<version>.exe` à une adresse **https** (hébergement o2switch, dossier
   `telechargements/`).
3. Écrire le manifeste, sur le poste de build :

   ```json
   { "channel": "stable", "version": "0.2.0", "notes": "Corrections de l'impression.", "downloadUrl": "https://afrikaisse.dametta.com/telechargements/AfriKaisse-Setup-0.2.0.exe", "installer": "../sortie/AfriKaisse-Setup-0.2.0.exe" }
   ```

4. **Signer sur le poste de build**, la clé privée seulement dans la session du terminal :
   `AFK_RELEASE_PRIVATE_KEY=<clé privée> node services/api/dist/cli.cjs release-sign manifeste.json`
   → `manifeste.signe.json` (empreinte SHA-256 calculée depuis l'installateur, signature vérifiée).
5. **Publier dans le Cloud** (SSH o2switch, sans clé privée) : `node cli.cjs release-publish manifeste.signe.json`.
   La signature est vérifiée avec la clé publique embarquée ; une annonce que les serveurs locaux
   refuseraient n'est pas publiée. Une version déjà publiée sur un canal est refusée.

`GET /api/public/releases/latest?channel=stable` sert la plus haute version (ordre semver). Les serveurs
locaux la vérifient toutes les 6 h et sur **Supervision → Rechercher une mise à jour**. Ils affichent le
lien ; **rien ne s'installe seul**.

### 4.3 Construire l'installateur Windows (console comprise)

Prérequis sur le poste de build : Node 24, **Inno Setup 6** (`ISCC`), **Python + Pillow** (icône ; variable
`PYTHON` si `python` du PATH n'est pas le bon, par exemple `PYTHON=C:/Users/<vous>/anaconda3/python.exe`), un
`node.exe` 24 win-x64 à embarquer (`AFK_NODE_EXE`), et le **réseau au premier empaquetage de la console**
(téléchargement unique d'Electron, ~110 Mo, conservé dans `node_modules/electron/dist` ; `ELECTRON_MIRROR`
pour un miroir).

```bash
npm ci
npm run verify                                  # types + tests (dont console et tâche planifiée) + builds
node infrastructure/windows/build.mjs --console # API, web, console empaquetée, charge, installateur
```

| Étape | Commande seule | Sortie |
|---|---|---|
| Console (bundle) | `npm run build -w @afrikaisse/desktop` | `apps/desktop/dist/` |
| Console empaquetée | `npm run package -w @afrikaisse/desktop` | `apps/desktop/sortie/console/AfriKaisse.exe` (~340 Mo décompressés : Electron 44, langues fr, en-US, ar) |
| Essai de la console | `npm run start -w @afrikaisse/desktop` (après le bundle ; `AFK_HOME_DATA`, `AFK_APP_DIR`) | fenêtre Electron |
| Charge sans installateur | `node infrastructure/windows/build.mjs --sans-installateur` | `infrastructure/windows/charge/` |

Sans `--console`, `build.mjs` reprend `apps/desktop/sortie/console` s'il existe ; sinon l'installateur se
construit **sans console** (icône vers le navigateur, comme en phase 11) et le journal de construction le dit
(« SANS la console »).

Rien n'est signé (DESKTOP.md, « Signature ») : SmartScreen avertit à l'installation.

Avant la première diffusion, sur un **PC d'essai** (jamais le poste de développement) : installer, redémarrer
**sans ouvrir de session** et appeler `http://<IP>:<port>/api/health` depuis une tablette ; vérifier
`schtasks /Query /TN "AfriKaisse\Serveur" /V` (compte `LOCAL SERVICE`), `journaux\superviseur.log` et
`journaux\installation.log` ; tuer `node.exe` dans le Gestionnaire des tâches et constater la relance ; lancer la
console depuis un compte standard serveur arrêté ; mettre à jour depuis la version précédente ; désinstaller
(données conservées, tâche absente).

### 4.2 Procédure de mise à jour sûre, chez le client

1. Fin de service : **clôturer la caisse** et laisser partir la synchronisation (Supervision :
   « 0 en attente »).
2. **Supervision → Mise à jour** : noter l'empreinte SHA-256, télécharger. Vérifier l'empreinte :
   `certutil -hashfile AfriKaisse-Setup-<version>.exe SHA256`. Différente : ne pas installer.
3. Lancer l'installateur. Il **arrête AfriKaisse**, puis **copie la base** (et son journal WAL) dans
   `C:\ProgramData\AfriKaisse\sauvegardes\avant-mise-a-jour\` avant de remplacer le programme. Si la
   copie échoue, l'installation s'annule sans rien modifier.
4. Au redémarrage, le serveur refait une copie vérifiée **avant ses migrations**
   (`afrikaisse-…-demarrage.sqlite`), puis migre.
5. Contrôle : Supervision au vert, nouvelle version affichée.

**Revenir en arrière** : réinstaller la version précédente, quitter AfriKaisse, remplacer
`afrikaisse.sqlite` (et `afrikaisse.sqlite-wal` s'il existe dans la copie) par ceux de
`sauvegardes\avant-mise-a-jour\`, supprimer un éventuel `afrikaisse.sqlite-wal` restant à côté de la
base, relancer. Les données saisies depuis la mise à jour sont perdues sur ce PC ; celles déjà
synchronisées sont dans le Cloud.

Pourquoi une copie dans l'installateur alors que le serveur en fait une au démarrage : la copie de
démarrage sort de la rotation horaire au bout d'un jour. Pour revenir à l'ancienne version plusieurs
jours après, il faut la base d'avant la mise à jour ; l'installateur en garde une, hors rotation,
remplacée à chaque mise à jour.

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

## 6. Sécurité en production

- Garder `AFK_TRUST_PROXY` à sa valeur Cloud (vrai) : derrière Passenger, c'est ce qui donne aux
  limites par adresse IP la vraie adresse du client.
- Poser la politique de sécurité du contenu sur les pages de l'application, dans le `.htaccess` du
  dossier web :

```apache
<IfModule mod_headers.c>
  <FilesMatch "\.html$">
    Header set Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  </FilesMatch>
</IfModule>
```

  Si l'API est servie sur un autre sous-domaine que l'application, ajouter son adresse à `connect-src`.

## Limites d'un mutualisé

Suffisant pour les premiers dizaines de restaurants. L'architecture n'a **aucune dépendance propre à
o2switch** (Node + PostgreSQL standard, fichier unique) : passer à un VPS se fait en changeant
d'hébergeur, sans toucher au code.
