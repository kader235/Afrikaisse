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

**Livré en phase 11** : `node infrastructure/windows/build.mjs` → `AfriKaisse-Setup-<version>.exe`.
Détail dans LOCAL.md, « Installation chez le client ».

- `C:\Program Files\AfriKaisse` (programme) et `C:\ProgramData\AfriKaisse` (données).
- Démarrage du serveur à l'ouverture de session. Pare-feu par programme, limité au sous-réseau local.
- Premier lancement : configuration hors ligne (« Créer mon restaurant »). L'appairage Cloud viendra avec la synchronisation.
- Une seule icône « AfriKaisse », aucun script visible.
- Désinstallation : **les données sont conservées**.

Restent pour la phase 16 : service Windows, console Electron (zone de notification, appairage par
QR), signature du code pour éviter l'avertissement SmartScreen. L'état du système existe déjà dans
l'application web (**Administration → Supervision**, §68).

## Mise à jour (§73)

- Le serveur local annonce la nouvelle version (signature Ed25519 vérifiée) dans **Supervision** ; il ne
  télécharge ni n'installe rien.
- **Avant de remplacer le programme**, l'installateur arrête AfriKaisse puis copie `afrikaisse.sqlite`
  (et `afrikaisse.sqlite-wal`) dans `C:\ProgramData\AfriKaisse\sauvegardes\avant-mise-a-jour\`
  (`SauvegarderAvantMiseAJour` dans `AfriKaisse.iss`). Échec de la copie : installation annulée.
- Au démarrage, le serveur refait une copie vérifiée avant ses migrations.
- Procédure complète et retour arrière : DEPLOYMENT.md §4.2.

## Journaux (§74)

`C:\ProgramData\AfriKaisse\journaux\` : un fichier par catégorie (application, security, sync,
printer, database, system), à rotation (LOCAL.md). Le lanceur passe `AFK_LOG_DIR`.

## Pièges connus (Scolaar, PHARMINA)

- **Ports réservés dynamiquement** par Hyper-V/WSL : jamais de port en dur. Le choix résistant est
  déjà dans `listenLocal`.
- `ELECTRON_RUN_AS_NODE` défini dans l'environnement de build : l'enlever pour lancer Electron en
  mode graphique.
- Tous les `spawnSync` avec délai et `SIGKILL` : un outil qui pend ne doit pas figer le lanceur.
- Signature de code à prévoir, sinon SmartScreen avertit à l'installation.
