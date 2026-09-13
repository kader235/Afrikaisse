# AfriKaisse — Application mobile (phase 15)

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
