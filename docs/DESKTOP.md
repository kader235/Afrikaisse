# AfriKaisse — Logiciel desktop Windows (phases 11 et 16)

## Choix (ADR-007, révisé en phase 16)

| Composant | Technologie | Pourquoi |
|---|---|---|
| Serveur local | **Tâche planifiée « AfriKaisse\Serveur »** au démarrage de Windows, compte **Service local**, qui lance un **superviseur** Node (`lanceur/service.cjs`) puis `server.cjs` | Démarre sans session ouverte, se relance seul, aucun binaire tiers |
| Console | **Electron 44** (`apps/desktop`), empaquetage manuel sans electron-builder | Node inclus ; chaîne éprouvée sur PHARMINA ; Rust et MSVC (Tauri) absents du poste |
| Base | SQLite via `node:sqlite` | Aucun module natif, aucun service de base à installer |
| Installateur | **Inno Setup 6** | Éprouvé sur Scolaar (installation tout-en-un) |

### Pourquoi une tâche planifiée plutôt qu'un « vrai » service Windows

Un service Windows exige un exécutable qui dialogue avec le gestionnaire de services (SCM). Node ne le fait
pas seul. Les options examinées :

| Option | Pour | Contre | Retenue |
|---|---|---|---|
| **WinSW** (exe unique, MIT) | Vrai service, relance par le SCM | Binaire tiers à télécharger à chaque construction, à vérifier et à tenir à jour ; .NET selon la version ; un exe de plus que les antivirus examinent | Non |
| node-windows / NSSM | Idem | Même binaire tiers (NSSM n'est plus maintenu) ; node-windows télécharge WinSW | Non |
| **Tâche planifiée** (Planificateur de tâches) | Dans Windows ; démarrage **au boot, sans session** ; compte **Service local** sans mot de passe ; créée en une commande (`schtasks /Create /XML`) par l'installateur ; aucune dépendance | Pas de console « Services » ; relance à écrire | **Oui** |

La relance est assurée à deux niveaux :
1. **Superviseur** (`lanceur/service.cjs`) : il démarre `server.cjs` et le relance s'il s'arrête (1 s, 2 s,
   5 s, 10 s, 30 s, puis chaque minute ; la série repart à zéro après 10 minutes de marche). Il relance aussi un
   serveur qui ne répond plus à `/api/health` depuis 3 minutes (le contrôle attend le fichier de port, écrit
   après les migrations : jamais pendant une première installation). Journal : `journaux\superviseur.log`.
2. **Windows** : le déclencheur « au démarrage » est **répété toutes les 5 minutes** avec « ne pas lancer de
   nouvelle instance » ; si le superviseur a disparu, Windows le relance. Plus « redémarrer en cas d'échec »
   (999 fois, chaque minute).

Réglages de la tâche (`lanceur/tache.cjs → buildTaskXml`, testés) : aucune limite de durée, pas d'arrêt sur
batterie ni en inactivité, priorité normale, `Service local` (`S-1-5-19`, droits minimaux). Descripteur de
sécurité : administrateurs et système en contrôle total, **utilisateurs authentifiés en lecture et lancement**
(la console relance le serveur sans demander de mot de passe) ; refusé, la tâche est recréée sans lui.

Le superviseur ne double jamais un serveur : si un serveur AfriKaisse répond déjà (même nœud), il le surveille
et reprend la main s'il s'arrête. Un seul superviseur à la fois (`superviseur.pid`, vérifié avec le nom du
programme : Windows réutilise les numéros de processus).

Le Service local écrit dans `C:\ProgramData\AfriKaisse` grâce à `icacls` (Inno Setup n'a pas d'identifiant
« localservice ») ; les utilisateurs gardent la modification (fichier de port, journaux, sauvegarde depuis la
console). Écoute, port choisi dynamiquement, fichier de port et pare-feu par programme sont **inchangés**
depuis la phase 11 : la tâche lance le même `node.exe`.

## Fonctions

- **Serveur local** (§51) : caisse, commandes, cuisine, **impression** (ESC/POS en TCP 9100, dans le serveur),
  **synchronisation** avec le Cloud, sauvegardes horaires. Il tourne sans session ouverte et sans la console.
- **Console** (`apps/desktop`) :
  - **zone de notification** : état du serveur (« Serveur en marche · port 7300 »), menu **Ouvrir la caisse**,
    **État du système**, **Appairer une tablette**, **Sauvegarder maintenant**, **Démarrer avec Windows**
    (case), **Quitter la console** (le serveur continue) ; un clic sur l'icône ouvre la caisse ;
  - **caisse** plein écran : l'application web servie par le serveur local sur `http://localhost:<port>` (port
    lu dans `port.txt`, jamais en dur), contexte sécurisé ; F11 plein écran, F5 recharger ;
  - **État du système** (§68) : la Supervision de l'application web (`/#supervision`), donc l'API réelle
    `GET /api/locations/{id}/monitoring` avec les droits de la personne connectée ;
  - **Appairer une tablette** (§52) : fenêtre locale avec un **QR** de l'adresse du serveur (`lanUrls` de
    `/api/health`), l'adresse en clair, la carte réseau ; les cartes virtuelles (Hyper-V, WSL, VirtualBox,
    VPN) passent en dernier et sont signalées ; alerte si aucun restaurant n'est encore créé ;
  - **Sauvegarder maintenant** : `cli backup` (même copie vérifiée et même rotation que le serveur,
    `VACUUM INTO` + `integrity_check`), caisse ouverte, résultat en notification ;
  - **serveur arrêté** : fenêtre d'attente, puis lancement de la tâche planifiée ; 20 s sans réponse et aucun
    superviseur ni serveur en route : repli sur le lanceur (`demarrer.cjs --sans-navigateur`). Échec au bout de
    90 s (3 min au premier démarrage) : message, chemin du journal, **Réessayer**, **Ouvrir les journaux**.
- **Sauvegardes et restauration** (LOCAL.md).

### Contenu du QR

`http://<IP-LAN>:<port>` : ce que l'écran « Connexion au serveur » de la tablette accepte
(`normalizeServerUrl`), et ce qu'un appareil photo de téléphone ouvre dans le navigateur. **Pas de jeton** :
le serveur local n'a pas encore d'appairage d'appareil pour les tablettes (seul l'appairage PC ↔ Cloud existe,
phase 17) et l'application tablette n'a pas de lecteur de QR. Les personnes se connectent sur la tablette avec
leur compte. Un QR avec code à usage unique viendra avec les jetons d'appareil (LOCAL.md §53).

### Sécurité de la console

- `contextIsolation`, `sandbox`, pas de `nodeIntegration` ; outils de développement fermés dans la version
  empaquetée ; aucun menu d'application.
- **Navigation** limitée au serveur local de ce PC sur son port actuel (`http://localhost|127.0.0.1:<port>`)
  et aux fichiers `fenetres/` de la console (`navigation.ts`, testé). Nouvelles fenêtres refusées ; liens
  `https` (téléchargement d'une mise à jour) et `http` du réseau local (menu client) ouverts dans le
  navigateur de Windows ; tout le reste ignoré (`file:`, `ms-settings:`…). `<webview>` interdit.
- Permissions : seulement copier et plein écran, pour l'application locale.
- Le pont `window.afk` (preload) n'existe que dans les fenêtres locales ; chaque appel vérifie l'adresse de la
  fenêtre appelante.

### Démarrage automatique

| Quoi | Comment | Qui |
|---|---|---|
| Serveur | Tâche planifiée au démarrage de Windows | Tous, sans session |
| Console | Entrée « Exécuter » de l'utilisateur (`HKCU\…\Run`, nom `GlobalTech.AfriKaisse.Console`, option `--cache` : icône seule) | Chaque compte Windows : activée au premier lancement de la console, case **Démarrer avec Windows** ensuite |

## Installateur

`node infrastructure/windows/build.mjs [--console]` → `AfriKaisse-Setup-<version>.exe` (DEPLOYMENT.md §4.3,
LOCAL.md « Installation chez le client »).

- `C:\Program Files\AfriKaisse` (programme, console dans `console\`) et `C:\ProgramData\AfriKaisse` (données).
- **Tâche planifiée** enregistrée et lancée à la fin de la copie (`tache.cjs installer`). Refus : repli sur le
  démarrage à l'ouverture de session de la phase 11 (raccourci du dossier Démarrage commun), message et
  `journaux\installation.log`.
- Pare-feu par programme, limité au sous-réseau local.
- Icône « AfriKaisse » (menu Démarrer, Bureau) vers la **console** ; « AfriKaisse dans le navigateur » en plus.
  Console absente de la construction : icône vers le navigateur, comme en phase 11.
- Fin d'installation : la console s'ouvre sous le compte de la personne qui installe.
- Mise à jour depuis la phase 11 : l'ancien raccourci de démarrage « AfriKaisse (serveur) » est supprimé.
- Désinstallation : consoles fermées, tâche supprimée, superviseur et serveur arrêtés, règle de pare-feu et
  démarrage de la console (compte courant) retirés. **Les données sont conservées.**

## Mise à jour (§73)

- Le serveur local annonce la nouvelle version (signature Ed25519 vérifiée) dans **Supervision** ; il ne
  télécharge ni n'installe rien.
- **Avant de remplacer le programme**, l'installateur arrête AfriKaisse (`arreter.cjs` **désactive** la tâche,
  sinon sa répétition relancerait le serveur pendant la copie, puis arrête superviseur et serveur) et copie
  `afrikaisse.sqlite` (et `afrikaisse.sqlite-wal`) dans `C:\ProgramData\AfriKaisse\sauvegardes\avant-mise-a-jour\`
  (`SauvegarderAvantMiseAJour` dans `AfriKaisse.iss`). Échec de la copie : installation annulée, et la tâche
  est **réactivée** (`DeinitializeSetup`) : l'ancienne version repart.
- La tâche est recréée active par la nouvelle version.
- Au démarrage, le serveur refait une copie vérifiée avant ses migrations.
- Procédure complète et retour arrière : DEPLOYMENT.md §4.2.

## Signature

| Élément | Signé |
|---|---|
| Annonces de version (§73) | **Oui**, Ed25519 |
| `AfriKaisse-Setup-<version>.exe` | **Non** : SmartScreen avertit (« Informations complémentaires → Exécuter quand même ») |
| `console\AfriKaisse.exe` | **Non**. C'est `electron.exe` renommé : ses propriétés Windows et son icône d'exécutable restent celles d'Electron (les raccourcis, la fenêtre et la zone de notification ont l'icône AfriKaisse). `rcedit` et un certificat viendront ensemble |
| `node.exe` embarqué | Signé par la fondation OpenJS (binaire officiel) |

## Journaux (§74)

`C:\ProgramData\AfriKaisse\journaux\` : un fichier par catégorie (application, security, sync,
printer, database, system), à rotation (LOCAL.md). Plus `serveur.log` (sortie brute du serveur),
`superviseur.log` (démarrages, arrêts, relances) et `installation.log` (droits, tâche planifiée).

## Ce qui a été vérifié, ce qui ne l'a pas été (15/09/2026)

Vérifié sur le poste de développement (sans droits administrateur) : superviseur lancé à la main sur un dossier
de données d'essai (démarrage du serveur, relance 1 s après un arrêt forcé, second superviseur refusé),
`cli backup` pendant que le serveur tourne, console empaquetée lancée sur ce serveur (caisse chargée depuis
`http://localhost:7300`, fenêtre d'appairage avec le QR de la vraie adresse du LAN, `--appairage` et `--etat`
transmis à la console déjà ouverte, démarrage avec Windows écrit puis retiré), `arreter.cjs` (superviseur et
serveur arrêtés), installateur compilé avec (133 Mo) et sans (28 Mo) la console, tests unitaires (XML de la
tâche, fichier de port, adresses du QR, navigation autorisée).

Non cliqués : le menu de la zone de notification (mêmes fonctions que les fenêtres essayées) et la Supervision
après connexion (`#supervision`, aucun restaurant dans la base d'essai).

**Non vérifié** (exige un PC d'essai et un compte administrateur ; interdit sur le poste de développement) :
installation réelle, enregistrement de la tâche par `schtasks` (XML et descripteur de sécurité acceptés par
Windows), démarrage du serveur au boot sous Service local, droits `icacls`, lancement de la tâche par un
utilisateur standard, mise à jour depuis la phase 11 et désinstallation. **À faire avant la première diffusion.**

## Pièges connus (Scolaar, PHARMINA)

- **Ports réservés dynamiquement** par Hyper-V/WSL : jamais de port en dur. Le choix résistant est
  dans `listenLocal` ; la console et le superviseur lisent `port.txt`.
- `ELECTRON_RUN_AS_NODE` défini dans l'environnement de build : l'enlever pour lancer Electron en
  mode graphique (`apps/desktop/scripts/lancer.mjs` le retire).
- Aucun appel de programme sans délai et arrêt forcé (`commun.cjs → run`) : un outil qui pend ne doit figer
  ni le lanceur, ni l'installateur, ni la console.
- `schtasks /XML` : fichier en UTF-16 avec BOM.
- npm 11 ne télécharge pas le binaire d'Electron à l'installation : `empaqueter.mjs` lance `install.js`.
