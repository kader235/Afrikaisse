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
| Première fois | Crée la base PostgreSQL et son utilisateur (`uapi PostgresqlFE`), écrit `~/afrikaisse/.env` : mot de passe et secret JWT générés sur place, `chmod 600`. Un `.env` existant n'est jamais réécrit |
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
