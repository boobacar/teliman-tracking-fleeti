# Audit complet frontend et UI/UX — Teliman Tracking Fleeti

**Date :** 28 juillet 2026  
**Périmètre :** frontend React/Vite, 18 routes applicatives, 32 fichiers JSX, `App.css` (4 763 lignes), `index.css`, couche API, service worker et runtime HTTPS.  
**Mode :** audit en lecture seule. Aucune correction applicative, aucun commit, aucun push.  
**Production observée :** `https://home-server-1.tail660cfd.ts.net`

## 1. Verdict

L’interface possède une identité cohérente, une bonne base de composants, des routes lazy-loadées, un shell mobile travaillable et plusieurs protections déjà présentes. Elle reste néanmoins **non certifiable pour un usage terrain complet** avant correction des défauts P0/P1.

Les risques dominants sont :

1. connexion frontend impossible depuis le Funnel HTTPS sans redirection navigateur temporaire ;
2. injection HTML possible lors de l’impression d’un bon de livraison ;
3. perte de photos lors d’un upload multiple de preuves BL ;
4. exports de rapports pouvant utiliser le mauvais dataset ;
5. données de conformité faussement rassurantes ;
6. tableaux ou contenus métier masqués/tronqués sur mobile ;
7. mutations sans erreur visible ;
8. pollings concurrents et données périmées non signalées ;
9. pages trop longues, redondantes et difficiles à scanner ;
10. accessibilité insuffisante des tableaux, graphiques, lightboxes et commandes compactes.

### Niveau global

- **P0 — critique : 6 constats consolidés**
- **P1 — élevé : 20 constats consolidés**
- **P2 — modéré : 20 constats consolidés**
- **P3 — finition/dette : 10+ constats**

Les nombres consolident l’audit source et l’audit runtime ; les doublons ont été regroupés.

---

## 2. Méthode et niveaux de preuve

### Code

- lecture des routes, pages, composants, hooks et helpers ;
- audit CSS responsive et accessibilité ;
- vérification non mutante : lint et build réussis par les contre-auditeurs ;
- preuves indiquées par `fichier:ligne`.

### Runtime

Navigation authentifiée réelle en desktop sur : Dashboard, Map, Flotte, Chauffeurs, WhatsApp, Alertes, Analytics, Rapports, Rapport Chauffeurs, Rapport Trajets, Bons livraison, Carburant, Vidanges, Données et Utilisateurs.

### Limite mobile

L’analyse source responsive est exhaustive. Une passe Playwright 390 × 844 a été préparée, mais la session n’a pas été stabilisée après rechargement avant la clôture. Les défauts mobiles marqués **prouvés par le code** sont certains ; les autres restent à mesurer par capture après correction de la résolution backend Funnel.

### Classification

- **P0 :** sécurité, perte de données, résultat métier faux ou route essentielle inutilisable ;
- **P1 :** workflow majeur cassé, action silencieuse, contenu absent ou accessibilité sévère ;
- **P2 :** friction importante, responsive dégradé, état ambigu ;
- **P3 :** cohérence, finition et dette technique.

---

# 3. Constats P0

## P0-01 — Connexion du frontend cassée sur le Funnel HTTPS

**Preuve runtime.** Le formulaire affiche « Impossible de joindre le serveur » alors qu’un `POST /api/auth/login` same-origin manuel répond `200`. La couche de résolution backend tente une origine différente/private depuis l’hôte `*.ts.net`.

**Fichiers :** `src/lib/backendUrl.js`, `src/lib/fleeti.js`.  
**Impact :** l’application publique est visible mais l’authentification normale échoue.  
**Recommandation :** forcer `/api` et `/uploads` same-origin sur l’hôte Funnel ; ajouter un test E2E login → Dashboard → reload.

## P0-02 — Injection HTML/XSS dans l’impression BL

**Preuve source :** `src/lib/printDeliveryOrder.js:4-40`. Toutes les données sont interpolées sans échappement dans une chaîne transmise à `document.write()`.

**Impact :** référence, client, chauffeur, destination ou notes contenant du HTML peuvent exécuter du code dans la fenêtre d’impression.  
**Recommandation :** construire le document avec le DOM et `textContent`, ou échapper systématiquement `&<>"'`; ouvrir avec `noopener` et supprimer `window.opener`.

## P0-03 — Upload multiple BL écrasant les photos précédentes

**Preuve source :** `DeliveryOrdersPage.jsx:263-279,590-604,632-633`.

Chaque fichier reconstruit `currentPhotos` depuis le même objet initial. Plusieurs PATCH concurrents s’écrasent ; seule la dernière nouvelle photo peut subsister.

**Impact :** perte silencieuse de preuves métier.  
**Recommandation :** compresser tous les fichiers puis effectuer un seul PATCH atomique, ou recharger après chaque upload séquentiel ; test réel à deux/trois images avec reload.

## P0-04 — Export « Flotte & conformité » utilisant le rapport carburant

**Preuve source :** `ReportsPage.jsx:574-683,955-1050`. `getCurrentReportForExport()` ne traite pas `fleet-compliance` et retombe sur le dataset carburant.

**Impact :** PDF/CSV faux sous un titre de conformité.  
**Recommandation :** branche dédiée, schéma de colonnes explicite et export désactivé tant que la clé `{type,période}` n’est pas chargée.

## P0-05 — Assurance inconnue comptée comme valide

**Preuve source :** `ReportsPage.jsx:528-565`. Le statut démarre à `ok` et reste valide sans échéance reconnue.

**Impact :** indicateur de conformité faussement rassurant.  
**Recommandation :** valeur initiale `unknown`; `ok` uniquement avec date future valide ; normaliser les champs Fleeti.

## P0-06 — Contenus entiers masqués sur mobile

**Preuve source :** `App.css:3740-3742` masque `.delivery-table-panel .reports-table-wrap` sous 900 px. `TripsReportPage.jsx:670-690,714-737` et `DriversReportPage.jsx:248,287-307` utilisent cette combinaison sans vue mobile équivalente.

**Impact :** synthèse camion, détail des trajets et lignes du rapport chauffeur absents sur téléphone/tablette.  
**Recommandation :** masquer une table seulement lorsqu’une alternative mobile complète existe ; sinon garder un tableau scrollable ou produire des cartes équivalentes.

---

# 4. Constats P1 — fonctionnement et données

## P1-01 — Chargement global non adapté aux permissions

`App.jsx:107-127` charge rapports, BL, résumé BL et référentiels pour tous. Un seul 403 fait rejeter le `Promise.all` et annule les résultats réussis.

**Correction :** requêtes conditionnelles, `Promise.allSettled`, erreurs indépendantes et chargement par route.

## P1-02 — Mode suspension non bloquant

`App.jsx:426-456` ajoute un bandeau sans démonter routes, formulaires ni pollers.

**Correction :** écran de suspension exclusif et arrêt de tous les pollings.

## P1-03 — Route Chauffeurs n’active pas le bon mode

**Preuve runtime.** Naviguer de `/fleet` à `/drivers` conserve « Par camion / Trackers ». `initialMode` n’est pas resynchronisé lorsque le même composant est réutilisé.

**Correction :** synchroniser le mode à `location.pathname`/prop ou créer des routes réellement distinctes.

## P1-04 — Clic tracker sans résultat

`App.jsx:95`, `TrackersPage.jsx:13` : `selectedTrackerId` est mis à jour mais ignoré.

**Correction :** naviguer vers `/tracker/:id` ou afficher un panneau réellement connecté.

## P1-05 — Mutations sans erreur visible

**Fichiers :** `DataPage.jsx:139-190,387-396,527-536`, `OilChangesPage.jsx:217-238`, `FuelVouchersPage.jsx:185-203`, `FuelVoucherDetailPage.jsx:112-178`, `DeliveryOrderDetailPage.jsx:89-159`.

**Impact :** 403/timeout/500 donnent l’impression que le clic n’a rien fait.  
**Correction :** `try/catch/finally`, bouton occupé, toast bas arrondi, rechargement seulement après succès.

## P1-06 — Polling Map concurrent

`MapPage.jsx:127-159` : intervalle 3 s, timeout 12 s, aucun verrou `inFlight`.

**Impact :** empilement de requêtes et positions anciennes affichées comme actuelles.  
**Correction :** polling récursif après résolution, abort, timestamp et état « données anciennes ».

## P1-07 — Échec des tracés présenté comme absence d’alerte

`MapPage.jsx:250-276,325-326` remplace une panne par `trackMap={}` puis annonce « Aucune alerte géolocalisée ».

**Correction :** `loading/error/empty` distincts et bouton Réessayer.

## P1-08 — Tuiles de la carte absentes

**Preuve runtime.** La zone Leaflet présente de grands rectangles/images cassées.

**Correction :** contrôler CSP `img-src`, domaine de tuiles, erreurs console et attribution ; test visuel après déploiement.

## P1-09 — Dashboard live non rafraîchi

`DashboardPage.jsx:89-126` charge véhicules/odomètres seulement au montage ; le refresh global ne les recharge pas.

**Correction :** loader partagé, `refreshKey`, âge des données et erreur propre.

## P1-10 — WhatsApp affiche les erreurs comme des succès

`WhatsAppPage.jsx:110-121,235` utilise toujours `CheckCircle2` pour `actionMessage`.

**Correction :** état `{kind,message}`, icône/couleur adaptées et `role="alert"`.

## P1-11 — Un endpoint WhatsApp bloque tout le panneau

`WhatsAppPage.jsx:79-89` utilise `Promise.all(status, qr, templates, history)`.

**Correction :** `allSettled`, priorité statut/QR et erreurs indépendantes.

## P1-12 — Permissions administrables incohérentes

`AdminUsersPage.jsx:8-14,193-205`, `Layout.jsx:5-20` : permissions dupliquées et `manage_whatsapp`/`manage_drivers` absentes.

**Correction :** catalogue unique séparant accès page et action métier.

## P1-13 — Exports utilisant un ancien payload

`ReportsPage.jsx:449-478,686-801` conserve `operationalPayload` lors d’un changement de rapport/période.

**Correction :** vider au démarrage, associer à une clé immuable et bloquer l’export pendant le chargement.

## P1-14 — Rapport Trajets télécharge toute la flotte malgré le filtre

`TripsReportPage.jsx:426-475` filtre après l’appel batch.

**Correction :** filtrer les IDs avant l’appel, mettre en cache par période/IDs et limiter la période.

## P1-15 — Confirmation accessible non stylée

`ConfirmDialog.jsx:31-43` rend `.confirm-dialog-backdrop` et `.confirm-dialog`, mais aucune règle correspondante n’existe dans `App.css`.

**Impact probable :** dialogue injecté comme contenu normal en bas du document, action destructive invisible ou confondue avec la page.  
**Correction :** backdrop fixed, centrage, z-index, scroll interne et contenu arrière `inert`. À valider runtime immédiatement après style.

## P1-16 — Lightboxes inaccessibles

`DeliveryOrderDetailPage.jsx:307-310`, `FuelVoucherDetailPage.jsx:280-283` : simple `<div onClick>`, sans dialogue, bouton Fermer, Échap ni gestion du focus.

**Correction :** composant `ImageDialog` partagé.

## P1-17 — Lignes de tableaux mal modélisées

`<tr role="link">` contient des boutons/liens ; certaines lignes ne sont accessibles qu’à la souris.

**Fichiers :** `DeliveryOrdersPage.jsx:561-606`, `FuelVouchersPage.jsx:308-326`, `DriversReportPage.jsx:208-238`.

**Correction :** vrai lien dans la cellule principale et boutons séparés.

## P1-18 — Tous les tableaux sans caption/scope

15 tables recensées sans `<caption>` ni `scope` robuste.

**Correction :** caption visible ou `.sr-only`, `scope="col"`, `scope="row"` et colonne Actions nommée.

## P1-19 — Graphiques sans alternative accessible

`DashboardPage.jsx:216-252`, `AnalyticsPage.jsx:40-75`, `TrackerDetailPage.jsx:120-140`.

**Correction :** `figure`, titre, résumé et table/liste équivalente.

## P1-20 — Cibles tactiles trop petites

Exemples : effacement de date 20×20, pagination 36×36, actions Chauffeurs ~22×22.

**Correction :** 44×44 minimum, 48×48 pour actions terrain/destructives.

---

# 5. Constats P2 — cohérence, états et UX

1. **Filtre Dashboard ignoré** par plusieurs sous-listes — `App.jsx:375-384`.
2. **Bandeau “Aucun résultat” persistant sur les autres routes** — `App.jsx:356-360,431`.
3. **Panne auth assimilée à déconnexion** — `App.jsx:143-157,403-415`.
4. **Deux messages d’erreur globaux concurrents** — `App.jsx:129-137,428-430`.
5. **Error Boundary non réinitialisée à la navigation** — `ErrorBoundary.jsx:18-54`.
6. **BL “Livré” encore actif** possible — `DeliveryOrdersPage.jsx:97-113,451-459`.
7. **“Marquer livré” sans confirmation/verrou** — `DeliveryOrdersPage.jsx:224-241`.
8. **Pannes initiales BL/Vidanges masquées ; Carburant transformé en liste vide**.
9. **Photos carburant non compressées** — risque mémoire/timeout mobile.
10. **Impossible de désassigner/effacer certains champs chauffeur** — `DriversPage.jsx:89-99`.
11. **Suppressions référentielles sans confirmation** — `DataPage.jsx`.
12. **Reset templates/déconnexion WhatsApp sans confirmation**.
13. **Cache de tracés Map sans TTL**.
14. **Alertes limitées silencieusement à 20×10 événements**.
15. **État des règles Alertes incohérent desktop/mobile**.
16. **KPIs/PDF Chauffeurs ne respectant pas le filtre chauffeur**.
17. **Libellé “7 derniers jours” faux avec période personnalisée**.
18. **Conformité bloquée sur Chargement après erreur/vide**.
19. **Cartes Chauffeurs mobiles rendues impossibles par `display:none` inline**.
20. **Date picker sans collision viewport ni restauration complète du focus**.

---

# 6. Audit visuel route par route

## Dashboard

**Points forts :** identité cohérente, cartes alignées, lecture immédiate des grandes métriques.  
**Défauts :** page très longue ; alertes/odomètre/anomalies répétés ; neuf camions tous qualifiés « prioritaires » ; conformité remplie de « Non renseigné » ; `Plateau` dans les graphiques ; `Non assigné` classé comme chauffeur ; unités incomplètes.  
**Action :** conserver synthèse flotte, urgences, carte rapide et missions du jour ; déplacer les détails vers les pages spécialisées.

## Live Map

Tuiles cassées, neuf KPI avant la carte, contrôles denses, absence de `<h1>`, carte essentiellement souris. Faire de la carte le contenu dominant et fournir une liste accessible synchronisée.

## Flotte / Chauffeurs

Absence de `<h1>`, statuts anglais, « Modèle inconnu » répété, aucune vraie tête de colonnes, `Plateau/XX`, clic tracker inopérant et route Chauffeurs incorrecte. Produire un tableau desktop et cartes mobile compactes.

## WhatsApp

Environ 3 500 px ; états déconnectés répétés ; message technique anglais `QR refs attempts ended`; bouton Déconnecter actif sans connexion ; statut, QR, test, historique et templates empilés. Créer les vues Connexion, Test, Historique et Templates.

## Alertes

Environ 4 190 px ; dates/colonnes droites coupées ; adresses très longues ; groupes difficiles à scanner ; pagination absente et troncature silencieuse. Garder camion, type, gravité, heure et action carte visibles.

## Analytics

Graphiques vides ou barres visuellement incohérentes alors que les listes contiennent des valeurs ; tooltip `mileage` en anglais ; unités absentes ; `Plateau`; Top alertes et Top anomalies presque identiques ; aucune période visible. Vérifier le mapping Recharts avant tout embellissement.

## Rapports

Environ 6 944 px pour 127 lignes ; une vingtaine de chips ; pas de pagination ; colonnes droites coupées ; total seulement en bas ; format `259,000` ambigu. Catégoriser, paginer, rendre l’en-tête sticky et formater `259 000 FCFA`.

## Rapport Chauffeurs

Colonnes Permis/Statut coupées ; coordonnées GPS brutes au lieu d’une destination exploitable ; `XX/Plateau` ; filtres non appliqués aux KPIs/PDF. Ajouter lien carte et cohérence intégrale du filtre.

## Rapport Trajets

Chargement long, trois grands tableaux, lignes à zéro, détail complet sans pagination, colonnes finales coupées et contenus supprimés sur mobile par CSS. Afficher l’activité uniquement par défaut et paginer.

## Bons de livraison

Environ 6 800 px ; les pseudo-onglets laissent tous les blocs visibles ; références prioritaires tronquées ; historique coupé ; Insights et Par camion répètent la table ; checkbox native « Bon actif » ; invariants Actif/Livré contradictoires. Rendre une seule vue interne à la fois.

## Bons carburant

Bonne structure générale et pagination, mais quatrième KPI isolé, colonne Actions coupée, champ calculé ressemblant à un champ éditable, recherche tronquée, preuve « Oui/Non » non actionnable et uploads non compressés.

## Vidanges

Les compteurs Urgent/À prévoir/OK restent à zéro faute d’historique ; table pleine de tirets ; fiche technique très haute et partiellement vide ; switch « filtre changé » activé par défaut ; tableau historique vide complet. Mettre en avant l’enregistrement initial avant de prétendre calculer un statut.

## Données

Badge de développement `PHASE 3 UI` visible ; huit CRUD dans une page ; répétitions « Données … disponible » ; suppressions à un clic ; informations de contact très denses ; checkboxes et switches incohérents. Scinder en onglets métier.

## Utilisateurs

Rôle « Lecture seule » affiché avec plusieurs droits activés ; bouton Créer avant la matrice ; permissions techniques brutes ; colonne Actions coupée ; liste non paginée ; protection du compte courant insuffisamment visible. Utiliser des presets de rôle et une matrice humaine avant validation.

---

# 7. Accessibilité et responsive

## Accessibilité

- `<h1>` unique absent sur la majorité des routes ;
- aucun lien « Aller au contenu » ;
- chips sans `aria-pressed`/tabs ;
- switches sans focus visible ;
- champs Chauffeurs non associés à leurs labels ;
- lightboxes non modales ;
- graphiques sans alternative ;
- tables sans caption/scope ;
- carte sans équivalent textuel complet ;
- erreurs parfois sans `role="alert"` ;
- contraste blanc sur `#b87a4a` calculé à environ **3,55:1**, probablement insuffisant pour du texte normal.

## Responsive

- cartes Chauffeurs mortes à cause du style inline ;
- tables Rapports Trajets/Chauffeurs entièrement masquées ;
- `min-width:1100px` imposé aux chauffeurs ;
- règle mobile rendant certains boutons icônes pleine largeur ;
- contrôles de 20–36 px ;
- calendrier de 290 px sans collision detection ;
- styles inline à largeur fixe ;
- deux systèmes responsive superposés dans 91 Ko de CSS global.

---

# 8. Performance perçue et architecture

- App charge des domaines inutiles avant la route ;
- plusieurs pages refetchent ensuite les mêmes données ;
- Map peut empiler les appels toutes les 3 s ;
- Trips batch toute la flotte malgré un filtre ;
- listes très longues rendues sans pagination/virtualisation ;
- cache PWA `teliman-static-v2` non versionné par build ;
- hooks/services/query clients morts ou non utilisés ;
- 91 Ko de CSS global avec sélecteurs et breakpoints dupliqués.

**Orientation recommandée :** queries par domaine/route, cache et invalidation explicites, polling partagé, pagination serveur, version de cache injectée au build et consolidation progressive du CSS.

---

# 9. Plan de remédiation recommandé

## Lot A — P0 sécurité et exactitude

1. corriger le backend same-origin Funnel ;
2. neutraliser l’injection de l’impression BL ;
3. rendre l’upload multi-photo atomique ;
4. réparer exports conformité et payloads périmés ;
5. corriger le calcul d’assurance inconnue ;
6. restaurer les contenus mobile masqués ;
7. ajouter tests E2E de ces six parcours.

## Lot B — workflows majeurs

1. route Chauffeurs et navigation tracker ;
2. mutations avec état d’erreur commun ;
3. Map : tuiles, polling, fraîcheur et erreurs ;
4. suspension bloquante ;
5. Dashboard live ;
6. WhatsApp indépendant par sous-domaine ;
7. permissions administrables cohérentes.

## Lot C — structure UX

1. onglets réels BL, WhatsApp et Données ;
2. catégorisation/pagination Rapports ;
3. pagination Alertes et Trajets ;
4. nettoyage `Plateau`, `XX`, valeurs techniques et données de test ;
5. réduction des redondances Dashboard/Analytics ;
6. états loading/error/empty cohérents.

## Lot D — mobile et accessibilité

1. tableaux/cartes équivalents ;
2. dialogues/lightboxes accessibles ;
3. `<h1>`, captions, scopes, labels et noms accessibles ;
4. cibles 44–48 px ;
5. alternatives aux graphiques et à la carte ;
6. contraste et focus ;
7. captures 390/768/1280 px route par route après chaque lot.

---

# 10. Critères de clôture

L’audit ne devra être considéré comme remédié qu’après :

- tests de login Funnel et rechargement ;
- tests d’impression avec caractères HTML neutralisés ;
- upload de 2–3 photos puis reload et contrôle de persistance ;
- comparaison écran/PDF/CSV de chaque rapport ;
- test permissions par rôle ;
- simulation 403, 500, offline, timeout et suspension ;
- aucune requête Map concurrente ;
- captures desktop/mobile de toutes les routes ;
- navigation clavier complète ;
- test des dialogues et lightboxes avec Échap/focus ;
- contrôle qu’aucun tableau métier n’est masqué sans alternative ;
- validation visuelle finale et contre-relecture indépendante.

## Conclusion

La base visuelle est exploitable et plusieurs primitives sont déjà de bonne qualité. La priorité n’est pas une refonte esthétique globale : il faut d’abord sécuriser les sorties métier, préserver les preuves, fiabiliser les états réseau, rendre la navigation déterministe et empêcher la disparition/troncature des données. La remédiation peut ensuite réduire la longueur et la redondance tout en conservant l’interface mobile compacte demandée.
