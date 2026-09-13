# AfriKaisse Local — le serveur du restaurant

## Rôle

Le serveur local permet au restaurant de **travailler sans Internet** : POS, commandes, KDS,
impression, caisse, stock. C'est le même programme que le Cloud (`services/api`), lancé en
`AFK_PROFILE=local` avec une base SQLite.

| | Cloud | Local |
|---|---|---|
| Base | PostgreSQL | SQLite (fichier, WAL, `synchronous=FULL`) |
| Tenants | Plusieurs | **Un seul** (inscription refusée une fois configuré) |
| Écoute | Passenger | LAN `0.0.0.0`, port choisi dynamiquement |
| Back-office AfriKaisse | Oui | Non (routes absentes) |
| Événements de synchro | Déjà « arrivés » (`SYNCED`) | `PENDING` jusqu'à l'envoi |
| Cookies | `Secure` | Non sécurisés (HTTP sur le LAN) |

## Ce qui existe depuis la phase 1

- Profil `local` complet : authentification hors ligne, rôles, audit, journal de synchronisation.
- **Choix de port résistant** (`services/api/src/main.ts → listenLocal`). Windows réserve
  dynamiquement des plages de ports (Hyper-V, WSL, Docker) qui refusent l'écoute (`EACCES`). Constaté
  sur le poste de développement : le port 4300 refusé le 13/09/2026, alors qu'il marchait pour Scolaar
  en août. Le serveur essaie le dernier port retenu, puis le port configuré, puis une liste de repli,
  et **mémorise** le gagnant dans `node_state` pour que les appareils appairés le retrouvent.
- Bundle unique `services/api/dist/server.cjs` exécutable par un Node 24 embarqué.
- La liste de repli exclut les ports **refusés par les navigateurs** (6000, 6665-6669, 10080…).
  Sinon le serveur démarrerait, mais aucune tablette ne pourrait l'appeler.

> **Mesure du 13/09/2026 sur le poste de développement** : l'écoute **IPv4** est refusée sur presque
> tous les ports essayés (3001, 4300, 5173, 7300, 8300, 9300, 18300, 24300 : `EACCES` sur
> 127.0.0.1, `EADDRINUSE` sur 0.0.0.0), alors que l'**IPv6** (`::`, `::1`) passe partout, et que
> 3000 et 18400 passent en IPv4. `netsh … excludedportrange` ne montre qu'une plage (50000-50059) :
> les exclusions ne sont pas toutes visibles. **Phase 11** : le serveur local devra essayer des
> couples (adresse, port) et vérifier qu'il est **joignable depuis l'IP du LAN** (auto-appel), pas
> seulement que `listen()` a réussi.

Lancer un serveur local de développement :

```bash
cd services/api
AFK_PROFILE=local AFK_DB=sqlite:.data/local.sqlite npm run dev
```

## Installation chez le client (phases 11 et 16)

- **Service Windows « AfriKaisse Local »** : Node 24 embarqué + `server.cjs`. Il démarre sans session
  ouverte et redémarre après une panne.
- **Données** dans `C:\ProgramData\AfriKaisse` (ACL : service + administrateurs). **Programme** dans
  `C:\Program Files\AfriKaisse` (non modifiable sans droits d'administrateur). C'est la vraie
  protection contre les virus, pas un dossier caché (leçon Scolaar).
- **Console Electron** : POS du poste principal, état du système (§68), appairage, sauvegardes.
- **Pare-feu** : règle entrante limitée au **profil réseau privé** et au port retenu.
- **Installateur Inno Setup** : un seul fichier, une seule icône, aucun script visible.

## Découverte des appareils (§52)

1. **Méthode fiable (défaut)** : la console affiche un **QR d'appairage** qui contient
   `http://<IP-LAN>:<port>`, l'identifiant du serveur et un code à usage unique. L'application
   serveur (Capacitor) le scanne, s'enregistre comme appareil et garde l'adresse.
2. **Recherche automatique** dans l'application native : diffusion UDP sur le LAN, le serveur répond
   avec son adresse. Si l'IP a changé, l'application la retrouve seule.
3. **`afrikaisse.local`** (mDNS) en complément sur les postes qui le résolvent (Windows 10+). Pas
   fiable sur Android, donc jamais la seule méthode.
4. Recommandation d'installation : **réservation DHCP** du PC serveur sur la box.

## Sécurité du LAN (§53)

- Écoute sur le LAN uniquement. Le serveur local **n'est jamais exposé à Internet**, et aucun port
  n'est ouvert sur la box : la synchronisation est sortante.
- Chaque tablette ou téléphone est **un appareil appairé** (jeton d'appareil révocable depuis la
  console). Un appareil volé se révoque sans toucher aux autres.
- Les personnes se connectent par e-mail et mot de passe, ou par **code PIN** sur un appareil déjà
  appairé (phase 6). Le PIN est haché comme un mot de passe et verrouillé après plusieurs échecs.
- Contexte non sécurisé (HTTP sur une IP de LAN) : pas de service worker, de caméra ni de
  notifications dans un navigateur. D'où l'application **native** pour le personnel. Sur le PC
  lui-même, `http://localhost` est un contexte sécurisé.

## Sauvegardes (§69)

- Sauvegarde **à chaud** par l'API `backup()` de SQLite (cohérente même pendant l'écriture), toutes
  les heures et à la fermeture de caisse, avec rotation (24 horaires, 30 quotidiennes).
- **Copie hors du PC** proposée : clé USB détectée, dossier réseau, ou envoi chiffré au Cloud. Un
  virus ou un disque mort emporte aussi ce qui est sur le même disque.
- Restauration guidée depuis la console, avec contrôle d'intégrité (`PRAGMA integrity_check`) avant
  remplacement.
- La console affiche en permanence : dernière sauvegarde, dernière synchronisation, état du système.

## Mises à jour (§73)

- Le serveur local interroge le Cloud : version disponible, empreinte SHA-256, signature Ed25519.
- Téléchargement, vérification de la signature, **sauvegarde avant migration**, arrêt du service,
  remplacement, migrations, redémarrage, contrôle `/api/health`. En cas d'échec : retour à la
  version précédente **et** à la sauvegarde.
- Jamais pendant une session de caisse ouverte.
