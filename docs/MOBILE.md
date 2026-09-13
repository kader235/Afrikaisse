# AfriKaisse — Application tablette et mobile

> **Priorité : la tablette** (ADR-011, 13/09/2026). La coque Android pour tablette est avancée en
> **phase 2 bis**, juste après les établissements et les tables, avant le POS. Le téléphone
> (serveur, manager) suit avec le même projet. La phase 15 ne garde que les compléments : push
> fermé, Bluetooth, iOS.
>
> Tablette de référence : Android 10", 1280×800, **Android 11 et WebView jamais mise à jour
> possibles**. À tester sur une vraie tablette et sur un émulateur API 30.

## Application tablette (phase 2 bis)

`apps/tablet` est l'enveloppe Android. Elle **embarque les écrans de `apps/web`** : la tablette démarre
même sans Internet, et chaque écran corrigé côté web l'est aussi sur la tablette.

| Sujet | Mise en œuvre |
|---|---|
| Premier lancement | Écran **Connexion au serveur** : *AfriKaisse Cloud* ou *Serveur local du restaurant* (adresse du PC, ex. `192.168.1.20:7300`). **Tester la connexion** appelle `/api/health` ; **Utiliser ce serveur** n'est actif qu'après une réponse valide. Changeable depuis la barre d'état des écrans d'accès. |
| Appels à l'API | HTTP natif (**CapacitorHttp**) : ni CORS ni « contenu mixte » entre l'enveloppe (`https://localhost`) et un serveur local en HTTP, et aucune dépendance à la version de la WebView. Délai maximal de 15 s par appel : un serveur éteint mène à l'écran « Serveur injoignable », jamais à une attente sans fin. |
| Session | Jeton d'accès en mémoire ; jeton de renouvellement dans le **Keystore Android** (`@aparajita/capacitor-secure-storage`), jamais dans le stockage de la WebView. Changer de serveur efface le jeton. |
| HTTP en clair | Autorisé dans le manifeste (le serveur local n'a pas de certificat), mais **refusé par l'application** vers toute adresse hors réseau local : `normalizeServerUrl` (`packages/core/src/network.ts`, testé) n'accepte `http://` que pour une IPv4 privée, `localhost` ou un nom en `.local`. |
| Identité | Icône et écran de lancement AfriKaisse (aplats bleus, ticket blanc), barres système bleu foncé. Régénérer : `python apps/tablet/android/dessiner-identite.py`. |
| Identifiant Android | `com.afrikaisse.tablette` — **définitif une fois publié** sur le Play Store : à confirmer avant publication. |

Construire l'APK de test : voir DEPLOYMENT.md §5.

## Choix : Capacitor (ADR-006)

Justification et comparaison avec React Native et Flutter : ARCHITECTURE.md §4. En résumé :
**les écrans serveur et manager existent déjà en React**, et les règles (panier, prix, droits) sont
en TypeScript. Capacitor produit un vrai APK Android avec plugins natifs, sans deuxième base de code
d'interface.

## Rôles servis

| Rôle | Écrans |
|---|---|
| Serveur | Mes tables (état couleur), prise de commande, envoi cuisine, suivi, demande d'addition, notifications « prête » / « table appelle » |
| Manager | Tableau de bord, ventes du jour, commandes, tables, alertes stock |
| Cuisine | KDS tablette si le restaurant n'a pas d'écran dédié |

## Architecture

- **Connexion au serveur local** par appairage QR (LOCAL.md). Repli sur le Cloud quand l'appareil
  est hors du Wi-Fi du restaurant (manager en déplacement).
- **Cache local** : SQLite (plugin Capacitor) pour le menu et les commandes en cours. File d'envoi
  avec UUID : une commande prise pendant une micro-coupure du Wi-Fi part dès le retour, sans doublon.
- **Jeton de renouvellement** dans le stockage sécurisé Android (Keystore), jamais dans les
  préférences en clair.
- **Notifications** : SSE du serveur local quand l'application est ouverte ; push (FCM) via le Cloud
  quand elle est fermée.
- **Impression Bluetooth ESC/POS** depuis le téléphone (restaurants sans PC).
- iOS : même projet Capacitor, le moment venu.

## Pièges connus (constatés sur WIFIHUB, à ne pas réapprendre)

- **Vieilles WebView** (Android 11 jamais mis à jour, Chrome 83) : page blanche sans cible de build
  adaptée. Cibles `es2019` / `chrome80`, pas de `gap` sur flexbox. Tester sur un émulateur API 30.
- `<a download>` ne fait rien dans une WebView : passer par `@capacitor/filesystem`.
- Capacitor accapare `localhost` : viser le serveur local par son IP.
- HTTP en clair vers le LAN : `usesCleartextTraffic` limité aux **adresses privées**
  (network security config), jamais global.
