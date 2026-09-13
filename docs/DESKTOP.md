# AfriKaisse — Logiciel desktop Windows (phases 11 et 16)

## Choix (ADR-007)

| Composant | Technologie | Pourquoi |
|---|---|---|
| Serveur local | **Service Windows** : Node 24 embarqué + `server.cjs` | Démarre sans session ouverte, survit à un plantage de l'interface |
| Console | **Electron** | Node inclus ; chaîne de build éprouvée sur PHARMINA ; Rust et MSVC (Tauri) absents du poste |
| Base | SQLite via `node:sqlite` | Aucun module natif, aucun service de base à installer |
| Installateur | **Inno Setup 6** | Éprouvé sur Scolaar (installation tout-en-un) |

## Fonctions

- **POS** plein écran du poste principal (même application React que le Web, servie par le serveur
  local sur `http://localhost:<port>`, un contexte sécurisé).
- **État du système** (§68) : Cloud, base, API, serveur local, synchronisation (en attente, en échec,
  conflits), imprimantes, KDS connectés, dernière sauvegarde.
- **Appairage** : QR affiché pour les tablettes et téléphones ; liste des appareils, révocation.
- **Impression** : agent intégré au service (ESC/POS en TCP 9100 ; USB par le spouleur Windows en
  mode brut).
- **Sauvegardes et restauration** (LOCAL.md).
- Icône de la zone de notification ; démarrage avec Windows.

## Installateur

- `C:\Program Files\AfriKaisse` (programme) et `C:\ProgramData\AfriKaisse` (données, ACL restreintes).
- Service installé et démarré ; pare-feu ouvert sur le **profil privé** uniquement.
- Premier lancement : code d'appairage Cloud, ou configuration hors ligne.
- Une seule icône « AfriKaisse », aucun script visible.
- Désinstallation : **les données sont conservées** sauf demande explicite.

## Pièges connus (Scolaar, PHARMINA)

- **Ports réservés dynamiquement** par Hyper-V/WSL : jamais de port en dur. Le choix résistant est
  déjà dans `listenLocal`.
- `ELECTRON_RUN_AS_NODE` défini dans l'environnement de build : l'enlever pour lancer Electron en
  mode graphique.
- Tous les `spawnSync` avec délai et `SIGKILL` : un outil qui pend ne doit pas figer le lanceur.
- Signature de code à prévoir, sinon SmartScreen avertit à l'installation.
