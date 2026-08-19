# Audit complet — Teliman Tracking Fleeti

**Date :** 28 juillet 2026  
**Périmètre :** code React/Vite, backend Express, API, authentification/autorisations, intégration Fleeti, SQLite, stockage Netac, PM2, HTTPS Tailscale Funnel, tests, build, lint, dépendances, performance et UX publique.  
**Révision auditée :** `master` — `85e7cfb` (`fix: proxy Vercel API requests through same origin`)  
**Environnement :** Raspberry Pi, Node/PM2, port 8787, données sur `/mnt/netac-storage/teliman-data`.

> **Verdict : ROUGE — service actuellement accessible, mais redémarrage et durabilité des données à risque immédiat.**
>
> Le frontend public, le build et les tests unitaires fonctionnent. En revanche, le support USB/EXT4 contenant la base est passé en état `shutdown` et la base ne peut plus être ouverte, y compris via les descripteurs du processus PM2. Le processus répond encore grâce au code et aux caches en mémoire, mais les opérations métier dépendant du disque ne sont plus fiables. Il ne faut **pas redémarrer PM2 ni la machine avant sauvegarde/récupération contrôlée**.

---

## 1. Résumé exécutif

### État observé

| Domaine | État | Résultat |
|---|---:|---|
| Service PM2 | ✅ | `online`, PID 1509, 0 redémarrage depuis le 18/07/2026 |
| Santé HTTP locale | ✅ partiel | `/api/health` → 200, mais ne vérifie ni SQLite ni le disque |
| Surface HTTPS | ✅ | Funnel → 200, TTFB observé ≈ 642 ms |
| Build production | ✅ | Vite construit en 1,50 s |
| Tests | ✅ limité | 68/68 passent en 0,99 s |
| Lint | ❌ | 71 erreurs + 1 avertissement |
| Dépendances | ❌ | 11 vulnérabilités prod : 2 critiques, 5 hautes |
| SQLite / stockage | 🔴 | `SQLITE_CANTOPEN`, erreurs EXT4 `error -5`, backups inaccessibles |
| Intégration Fleeti | 🟠 | nombreux `fetch failed` dans les logs ; cache/fallback maintient une partie de l’UI |
| WhatsApp Baileys | 🟠 | cycles répétés de 10 reconnexions puis nouvel essai |
| Audit UI authentifié | ⚪ bloqué | aucun secret manipulé ; navigateur isolé arrivé sur la connexion uniquement |

### Priorités absolues

1. **P0 — Sauvegarder/récupérer les données avant tout redémarrage.**
2. **P0 — Réparer le montage Netac/EXT4 hors ligne et remettre les backups sur un support indépendant.**
3. **P0 — Remplacer le token global : toute session peut actuellement usurper l’email d’un administrateur.**
4. **P0 — Supprimer les comptes de secours codés en dur et réparer la suppression persistante des utilisateurs.**
5. **P0 — Protéger les photos `/uploads` et les opérations WhatsApp par autorisation.**
6. **P1 — Corriger le crash PATCH Vidanges (`oilChangeUpdateSchema` inexistant).**
7. **P1 — Mettre à jour Baileys/React Router et traiter les 11 avis npm.**
8. **P1 — Remplacer le faux vert de `/api/health` par une readiness vérifiant réellement DB/stockage/Fleeti.**

---

## 2. Méthode et preuves exécutées

### Contrôles réellement lancés

- `git status`, branche, dernier commit et identité Git.
- métriques des fichiers suivis et des lignes par extension ;
- `npm test` ;
- `npm run build` ;
- `npm run lint` ;
- `npm audit --omit=dev --json` ;
- `npm outdated --json` ;
- état PM2, PID, cwd, script, CPU et mémoire ;
- santé locale et publique, en-têtes Helmet/rate-limit et timings HTTPS ;
- vérification anonyme des protections `/api/*` et de la règle CSRF JSON ;
- inspection des logs PM2 ;
- inspection du montage, des descripteurs SQLite ouverts et des avertissements kernel/EXT4 ;
- rendu visuel et arbre d’accessibilité de la page de connexion publique.

### Limites honnêtes

- Aucune donnée métier n’a été créée, modifiée ou supprimée pendant l’audit.
- Aucun mot de passe, token ou contenu de `.env` n’a été lu.
- Le navigateur d’audit isolé n’était pas authentifié ; la revue fonctionnelle des écrans internes repose donc sur le code, les routes, les tests et les API non destructives. Une passe visuelle authentifiée route par route reste à faire avec une session ouverte manuellement.
- `cua-driver` était indisponible sur cet hôte, donc aucune session desktop existante n’a été réutilisée.

---

## 3. Architecture et métriques

### Architecture

- **Frontend :** React 19 + Vite 8 + React Router 7.
- **Backend :** Express 5 monolithique dans `server.js`.
- **Données :** SQLite `better-sqlite3` pour BL, bons carburant, utilisateurs, référentiels et overrides ; plusieurs domaines restent en JSON (vidanges, WhatsApp, cache télémétrie, affectations).
- **Cartographie :** Leaflet/React Leaflet et MapLibre présents.
- **Rapports :** jsPDF, autotable, Recharts.
- **Messagerie :** Baileys / WhatsApp.
- **Exploitation :** PM2 + Tailscale Funnel.

### Taille

| Type | Fichiers | Lignes |
|---|---:|---:|
| JSX | 30 | 8 534 |
| JavaScript | 38 | 7 797 |
| CSS | 2 | 4 720 |
| Markdown | 4 | 996 |
| Total source JS/JSX/CSS/HTML | — | ≈ 21 080 |

Fichiers les plus lourds :

- `src/App.css` : **4 695 lignes** ;
- `server.js` : **4 097 lignes** ;
- `src/pages/ReportsPage.jsx` : **1 053 lignes** ;
- `src/pages/TripsReportPage.jsx` : **737 lignes** ;
- `src/pages/DeliveryOrdersPage.jsx` : **663 lignes** ;
- `src/pages/OilChangesPage.jsx` : **662 lignes**.

### Modules visibles cartographiés

1. Dashboard
2. Live Map
3. Flotte
4. WhatsApp
5. Alertes
6. Analytics
7. Rapports
8. Rapport Chauffeurs
9. Rapport Trajets
10. Bons livraison
11. Bons Carburant
12. Vidanges
13. Données
14. Utilisateurs
15. Détails BL, bon carburant et tracker via routes paramétrées

---

## 4. Constats critiques

### C-01 — Stockage Netac/EXT4 dans un état dangereux

**Sévérité : critique / P0**  
**Preuves runtime :**

- le kernel rapporte `EXT4-fs warning ... inode #9306113 ... error -5 reading directory block` ;
- `stat /mnt/netac-storage/teliman-data/backups` échoue avec `Input/output error` ;
- `sqlite3 -readonly /mnt/netac-storage/teliman-data/teliman.db` échoue avec `unable to open database file` ;
- les logs PM2 contiennent des `SQLITE_CANTOPEN` ;
- l’historique complet du log erreur contient environ **93 146 `SQLITE_CANTOPEN`** et **42 `database disk image is malformed`**, ce qui montre que le risque de corruption est antérieur au diagnostic du jour ;
- `findmnt` montre explicitement l’option EXT4 `shutdown` ;
- les descripteurs de `teliman.db`, `teliman.db-wal` et `teliman.db-shm` du processus actif existent encore mais renvoient eux aussi `Input/output error` ;
- le montage indique encore `/dev/sda1`, tandis que le périphérique Netac visible est désormais `sdb/sdb1`, signe cohérent avec une déconnexion/reconnexion USB et un montage devenu incohérent ;
- le dossier `backups` est lui-même illisible.

**Impact :**

- un redémarrage PM2 ou système peut empêcher Teliman de redémarrer ;
- les écritures peuvent échouer ou rester non durables ;
- les backups supposés disponibles ne sont pas consultables ;
- le `/api/health` actuel continue de répondre 200 et masque cette panne.

**Action :**

1. geler redémarrages et déploiements ;
2. réaliser une sauvegarde d’urgence vers le disque système ou un autre support sain, en incluant DB + WAL + SHM + JSON + uploads ;
3. planifier une fenêtre de maintenance : arrêt propre, démontage, `fsck` hors ligne sur le bon périphérique, remontage par UUID et vérification ;
4. restaurer sur un support sain si `fsck` signale des pertes ;
5. externaliser au moins une copie quotidienne hors du Netac.

### C-02 — Escalade de privilèges par usurpation d’email

**Sévérité : critique / P0**  
**Preuves :** `server.js:374-379`, `server.js:2830-2844`.

Après connexion, chaque utilisateur reçoit exactement le même `APP_SESSION_TOKEN`. L’identité effective de chaque requête est ensuite choisie par l’en-tête client `x-user-email`. Le backend retrouve l’utilisateur demandé et ne vérifie que le token global.

**Impact :** n’importe quel utilisateur possédant une session valide peut remplacer son en-tête email par l’adresse d’un administrateur connu et hériter de ses permissions `*`. C’est une escalade horizontale puis verticale complète.

**Action :** l’identité ne doit jamais être fournie séparément par le client. Créer une session opaque aléatoire liée côté serveur à un unique `userId`, ou un jeton signé contenant l’identité et les droits, court et révocable. Ajouter des tests négatifs : utilisateur limité + email admin forgé → 403.

### C-03 — Comptes administrateurs de secours codés en dur

**Sévérité : critique / P0**  
**Preuve :** `server.js:316-350`.

`parseAuthUsers()` contient quatre adresses administrateur, un salt constant et un hash constant. Si la lecture des utilisateurs échoue ou renvoie une table vide, ces comptes sont activés avec `permissions: ['*']`.

**Impact :** un défaut de données/authentification peut faire basculer silencieusement le système vers des identifiants de secours statiques et connus du code source.

**Action :** supprimer totalement ce fallback. Si `auth_users` est vide ou illisible, le serveur doit refuser de démarrer avec une erreur explicite. Prévoir une commande administrative hors ligne séparée pour recréer un compte.

### C-04 — Suppression d’utilisateur non persistante : les comptes peuvent ressusciter

**Sévérité : critique / P0**  
**Preuves :** `server.js:2912-2920`, `server.js:354-363`, `src/backend/database.js:251-253`.

L’API supprime l’utilisateur du tableau mémoire puis appelle `saveAuthUsers()`. Cette fonction ne supprime jamais les lignes absentes de SQLite : elle ne fait que des upserts. `deleteAuthUser()` existe mais n’est pas utilisé.

**Impact :** le compte semble supprimé dans l’UI, puis réapparaît au prochain redémarrage. C’est une faille de révocation d’accès.

**Action :** utiliser une transaction qui synchronise exactement SQLite avec la liste, ou appeler explicitement `deleteAuthUser(targetEmail)` avant de modifier le cache mémoire. Ajouter un test `delete → restart/reload DB → absent`.

### C-05 — Photos de preuve servies sans authentification et cachées après logout

**Sévérité : critique / P0**  
**Preuves :** `server.js:168-169` avant `protectAppSession` (`server.js:228-231`) ; `public/sw.js:47-50`.

`/uploads` est exposé en statique avant le middleware de session. Le service worker met en plus les uploads en cache-first dans `teliman-images-v1`.

**Impact :** toute personne connaissant/devinant une URL peut ouvrir une preuve de livraison/carburant sans session. Sur un appareil partagé, les images peuvent rester dans Cache Storage après déconnexion.

**Action :** déplacer les médias sensibles derrière une route authentifiée et autorisée, utiliser des identifiants non prédictibles ou des URLs signées courtes, envoyer `Cache-Control: private, no-store`, et exclure `/uploads` du service worker.

### C-06 — Autorisations manquantes sur toutes les opérations WhatsApp

**Sévérité : critique / P0**  
**Preuves :** `server.js:2491-2535`.

Les routes suivantes exigent seulement une session valide, sans permission métier :

- reconnecter/déconnecter WhatsApp ;
- envoyer un message de test ;
- modifier ou réinitialiser les templates.

Or `page_whatsapp` fait partie des permissions de base des utilisateurs non admin (`server.js:389-394`).

**Impact :** un utilisateur opérationnel peut couper le canal, effacer la session, envoyer des messages ou modifier les modèles.

**Action :** introduire des permissions distinctes (`manage_whatsapp_connection`, `send_whatsapp_test`, `manage_whatsapp_templates`) et les imposer côté API, pas seulement dans la navigation.

### C-07 — Vulnérabilités npm critiques/hautes en production

**Sévérité : critique / P0-P1**

`npm audit --omit=dev` remonte **11 vulnérabilités** :

- 2 critiques ;
- 5 hautes ;
- 3 modérées ;
- 1 basse.

Directes principales :

- `@whiskeysockets/baileys` : critique, version installée `7.0.0-rc.9`, mise à jour disponible ;
- `react-router-dom` : haute, version `7.14.0`, version corrigée disponible.

Transitives notables : `protobufjs` critique, `ws`, `sharp`, `@whiskeysockets/libsignal-node`, `dompurify`, `qs`.

**Action :** mettre à jour d’abord Baileys vers la release corrigée compatible et React Router vers `7.18.1` ou plus récente, puis relancer audit, tests, build et tests fonctionnels WhatsApp/navigation.

---

## 5. Constats importants — backend, API et sécurité

### I-01 — PATCH Vidanges casse à l’exécution

**Preuve :** `server.js:3265` référence `oilChangeUpdateSchema`, absent de l’import et absent de `src/backend/validation.js`.

Le lint le détecte comme `no-undef`. Toute modification d’une vidange renverra une erreur serveur capturée et transformée en réponse 400.

**Correction :** exporter `oilChangeUpdateSchema = oilChangeSchema.partial()`, l’importer, puis ajouter un vrai test API create/read/patch/reload/delete.

### I-02 — Création API d’utilisateur avec mot de passe optionnel

**Preuves :** `src/backend/validation.js:64-69`, `server.js:2861-2871`.

`password` est optionnel dans `adminUserSchema`. L’API peut donc calculer un hash de chaîne vide. Le formulaire UI exige un mot de passe, mais l’API ne doit jamais dépendre de l’UI.

**Correction :** schéma create séparé avec longueur minimale (12+ caractères ou politique adaptée), schéma update partiel distinct.

### I-03 — Session globale, persistante et exposée à JavaScript

**Preuves :** `server.js:2830-2845`, `src/lib/fleeti.js:21-25,101-105`.

Tous les utilisateurs reçoivent le même `APP_SESSION_TOKEN`, stocké dans `localStorage`, sans expiration ni révocation individuelle. Le logout n’invalide rien côté serveur. Ce modèle est aussi la cause racine de l’escalade C-02.

**Impact :** un token volé reste valide jusqu’à rotation globale ; une révocation utilisateur dépend du cache mémoire/DB ; une XSS aurait accès au token.

**Correction :** sessions aléatoires par login, hashées côté serveur, avec expiration, révocation et cookie `HttpOnly; Secure; SameSite=Strict/Lax`. À défaut, JWT court + rotation/denylist.

### I-04 — CSP désactivée

**Preuve :** `server.js:139-142` (`contentSecurityPolicy: false`).

Helmet fournit plusieurs bons en-têtes, mais l’absence de CSP augmente fortement l’impact d’une injection, particulièrement avec un token dans `localStorage`.

**Correction :** CSP explicite autorisant seulement les domaines réellement requis (Fleeti, tuiles, fonts), avec nonces/hashes si nécessaire. Éviter les images Leaflet chargées depuis unpkg au runtime en les embarquant localement.

### I-05 — CORS trop large sur les réseaux privés et tous les sous-domaines `ts.net`

**Preuve :** `server.js:257-293`.

Toute origine `*.ts.net`, tout host `10.*`, `172.*`, `192.168.*` ou `100.*` est accepté. C’est plus large que les origines Teliman réelles.

**Correction :** liste exacte d’origines, séparée par environnement ; ne pas accepter un bloc IP entier ni tous les domaines Tailscale Funnel.

### I-06 — Contrôle CSRF par sous-chaîne fragile

**Preuve :** `server.js:150-166`.

Le contrôle autorise une origine si elle contient `teliman`, ce qui n’est pas une validation d’origine exacte. Le CORS réduit aujourd’hui le risque navigateur, mais les deux règles sont incohérentes.

**Correction :** réutiliser la même fonction stricte `isAllowedOrigin()` et ajouter un token CSRF si passage aux cookies.

### I-07 — Permissions absentes sur overrides et affectations chauffeur

**Preuves :** `server.js:3890`, `3920`, `3954`, `3982`.

Ces mutations n’ont pas de `requirePermission`. Tout utilisateur authentifié peut les appeler directement.

**Correction :** permission dédiée `manage_drivers`/`manage_assignments`, contrôlée côté backend.

### I-08 — Réponses d’authentification permettant l’énumération des emails

**Preuves :** `server.js:2836-2842`.

L’erreur diffère entre email inconnu et mot de passe incorrect.

**Correction :** réponse générique identique, délai comparable, limite dédiée à `/api/auth/login` beaucoup plus stricte que 300/15 min, journalisation des échecs sans données sensibles.

### I-09 — Upload base64 non borné par fichier, fichiers orphelins et écriture non attendue

**Preuves :** `server.js:168`, `657-695`.

Le backend accepte un JSON de 10 Mo, décode les images puis lance `fs.promises.writeFile()` sans l’attendre, mais retourne immédiatement les URLs et persiste le BL. Les listes sont tronquées à dix chemins seulement après traitement : un grand tableau peut donc créer davantage de fichiers que ceux finalement référencés. Les suppressions/remplacements de BL ou bons carburant ne nettoient pas les anciens fichiers.

**Impact :** l’API peut annoncer un succès alors que le fichier échoue — scénario déjà plausible avec l’état du disque. Le BL peut référencer une preuve inexistante.

**Correction :** valider le nombre d’éléments avant toute écriture, upload multipart avec limite stricte type/taille, validation de signature MIME, nom aléatoire cryptographique, `await` de l’écriture, rollback/nettoyage en cas d’échec et garbage collection des médias orphelins.

### I-10 — `writeJSON()` absorbe les erreurs

**Preuves :** `server.js:39-57`, `516-525`.

Les vidanges et plusieurs fichiers opérationnels utilisent une écriture atomique qui journalise l’échec mais ne le propage pas. Les routes renvoient donc parfois un succès malgré une non-persistance.

**Correction :** rendre `writeJSON` réellement `async`, propager l’erreur jusqu’à une réponse 5xx et vérifier par relecture. Migrer les derniers domaines métier vers SQLite transactionnel.

### I-11 — Santé trop superficielle

**Preuves :** `/api/health` répond 200 alors que SQLite est impossible à rouvrir et le dossier backups est en E/S error.

**Correction :**

- `/health/live` : processus vivant uniquement ;
- `/health/ready` : `SELECT 1`, état WAL, accès au data dir, dernière sauvegarde saine, état Fleeti et espace disque ;
- réponse 503 si un composant critique échoue.

### I-12 — Backend monolithique

`server.js` fait 4 097 lignes et mélange configuration, auth, données, Fleeti, uploads, WhatsApp, rapports et routes.

**Correction incrémentale :** extraire routeurs/services par domaine et ajouter une couche transactionnelle/testable. Pas de réécriture complète.

### I-13 — Permissions de lecture insuffisantes

`protectAppSession` exige une session, mais les permissions par page ne sont pas appliquées à la majorité des lectures : positions GPS, chauffeurs, alertes, rapports, véhicules, employés détaillés, capteurs, règles, historique/QR WhatsApp. Le masquage du menu ne constitue pas un contrôle d’accès.

**Correction :** matrice explicite route × permission côté backend, tests négatifs pour chaque rôle, et garde de route frontend uniquement comme amélioration UX.

### I-14 — Token API accepté dans l’URL et journalisé

`server.js:311` accepte `api_key` dans la query string, tandis que `requestLogger` journalise `req.url` (`server.js:296-298`). Un secret peut donc finir dans PM2, proxies et historiques.

**Correction :** accepter le token uniquement dans un en-tête, supprimer/redacter query et headers sensibles dans les logs.

### I-15 — Fan-out Fleeti non borné

Plusieurs appels amont n’ont pas d’`AbortSignal`/timeout ; `/api/tracks/batch` accepte jusqu’à 100 trackers et les périodes ne sont pas suffisamment bornées. Une requête peut déclencher beaucoup d’appels et rester suspendue.

**Correction :** timeout, période maximale, concurrence bornée, quotas par utilisateur, retry limité avec jitter et circuit breaker.

### I-16 — Données Fleeti et erreurs amont trop directement exposées

Des réponses propagent des objets amont via `...event`/`...vehicle` ou renvoient directement `error.message`. Un nouveau champ fournisseur ou un message interne peut être exposé sans décision explicite.

**Correction :** DTO/Zod de sortie en allowlist et messages client génériques avec détails conservés seulement dans des logs structurés.

### I-17 — Configuration de démarrage contradictoire

`.env.example` présente l’API Fleeti privée et publique comme alternatives, mais `validateRequiredEnv()` exige toujours les quatre paramètres privés. `APP_SESSION_TOKEN`, pourtant obligatoire, n’est pas correctement documenté dans l’exemple.

**Correction :** documenter toutes les variables obligatoires et valider selon le mode fournisseur réellement choisi.

---

## 6. Données, SQLite et sauvegardes

### Points positifs

- WAL, `foreign_keys = ON` et `busy_timeout = 5000` sont configurés (`src/backend/database.js:8-18`).
- Les requêtes SQL utilisent des paramètres préparés.
- Des index existent pour tracker, statut, actif, référence et date sur les BL ; tracker/date sur les bons carburant.
- Les imports de migration sont transactionnels.

### Risques

1. **Impossible de vérifier l’intégrité actuelle via une nouvelle connexion**, à cause du problème de stockage.
2. **Backups inaccessibles** et aucun job automatique versionné identifié dans le repo.
3. **Schéma créé directement au démarrage**, sans table de version/migrations appliquées.
4. **Aucune FK métier** entre bons, trackers et référentiels ; les identifiants Fleeti externes rendent certaines FK difficiles, mais l’intégrité applicative doit être testée.
5. **Pas d’unicité DB sur la référence BL ou le numéro de bon carburant.** La déduplication applicative ne protège pas contre les concurrents/processus multiples.
6. **Mix SQLite + JSON** : les vidanges restent exposées aux pertes et aux écritures non attendues.
7. `readDeliveryOrders()` et `readFuelVouchers()` chargent tout puis paginent en mémoire (`server.js:3050-3061`, `3136-3147`). La compatibilité sans pagination maintient aussi un chemin non borné.
8. **Mutation BL non atomique :** désactivation de l’ancien BL puis insert/update sont deux commits distincts. En cas de changement de tracker, `server.js:3119` désactive même sur `current.trackerId` au lieu de `updatedItem.trackerId`.
9. **Migration non sécurisée :** `scripts/migrate-to-sqlite.js` importe les domaines séparément, continue après certaines erreurs et utilise `INSERT OR REPLACE`; une migration partielle peut être annoncée terminée et écraser des données natives.
10. `foreign_keys = ON` est actif, mais aucune clé étrangère n’est déclarée; plusieurs colonnes métier n’ont ni `CHECK` ni validation DB.

### Recommandations

- migration versionnée (`schema_migrations`) ;
- transactions métier pour « désactiver ancien BL + insérer nouveau BL » afin d’éviter un état intermédiaire ;
- index composite/partiel garantissant au plus un BL actif par tracker ;
- contraintes d’unicité normalisées sur références si la règle métier le permet ;
- pagination SQL (`LIMIT/OFFSET` ou curseur) et comptage séparé ;
- sauvegardes SQLite cohérentes via API backup/VACUUM INTO, rétention, copie hors support et test mensuel de restauration.

---

## 7. Intégration Fleeti et WhatsApp

### Fleeti

**Observé dans les logs :** répétitions de :

- `tracker/stats/mileage/read chunk failed: fetch failed` ;
- `history/tracker/list chunk failed: fetch failed` ;
- rapport généré sans carburant live.

Le backend possède des caches et fallbacks utiles, mais aucune télémétrie de disponibilité structurée n’est exposée.

**Recommandations :**

- distinguer frais/cache/dégradé dans chaque réponse ;
- afficher « dernière donnée fournisseur » et son âge ;
- métriques taux d’échec/latence par endpoint Fleeti ;
- circuit breaker et backoff avec jitter ;
- ne jamais transformer une absence réelle d’événements en données fictives.

### Données fictives dans le runtime

**Preuve :** `src/App.jsx:397-399` utilise `fallbackEvents` quand l’historique réel est vide ; `employeeFallback` participe aussi à la résolution des chauffeurs.

**Impact :** un historique légitimement vide peut afficher des alertes de démonstration comme si elles étaient réelles. C’est un risque de confiance opérationnelle.

**Action :** bannir les mocks du bundle production. Afficher un état vide/dégradé explicite, avec source et horodatage.

### WhatsApp

Le backoff existe, mais les logs montrent plusieurs séries complètes de 10 tentatives suivies d’une nouvelle série. Le garde-fou n’est donc pas globalement terminal.

**Action :** état `error` persistant après le maximum, aucune relance automatique tant qu’un opérateur n’a pas demandé « Reconnecter », et alerting unique.

---

## 8. Frontend, UX, accessibilité et performance

### Points positifs

- routes principales lazy-loadées ;
- Error Boundary autour des routes ;
- Skeleton commun ;
- navigation filtrée par permissions ;
- responsive CSS important avec seuil mobile 900 px ;
- cartes mobiles pour plusieurs tableaux métier ;
- `focus-visible` global ;
- `prefers-reduced-motion` présent ;
- formulaires BL majoritairement bien labellisés ;
- metadata, manifest, favicon et thème PWA présents ;
- page de connexion publique accessible en HTTPS.

### Problèmes

#### F-01 — Contraste cassé sur la connexion

La capture publique montre le titre « Connexion administrateur » presque blanc sur carte blanche, donc très peu lisible. C’est un défaut visuel et WCAG évident.

**Correction :** couleur explicite sombre pour le titre/texte de la carte login, puis test de contraste WCAG AA.

#### F-02 — Données métier entièrement masquées sur mobile

`App.css:3740-3742` masque toute `.reports-table-wrap` placée dans `.delivery-table-panel` sous 900 px. Une vue mobile équivalente existe pour BL/carburant, mais pas pour :

- kilométrage live et historique des vidanges ;
- règles Fleeti de la page Alertes.

**Impact :** ces informations disparaissent complètement sur téléphone, sans message ni alternative. C’est un défaut fonctionnel P0 pour l’exploitation mobile.

**Correction :** ne masquer une table que si une vraie carte/liste mobile équivalente existe; ajouter tests de rendu aux breakpoints 390, 680, 768 et 900 px.

#### F-03 — Boutons icône mobiles sans nom accessible

Dans `DeliveryOrdersPage.jsx:628-631`, les boutons mobiles ont seulement `title`, sans `aria-label`, contrairement à la version desktop.

**Correction :** ajouter `aria-label` à chaque action et tester au clavier/lecteur d’écran.

#### F-04 — Mots de passe affichés en clair dans l’administration

`AdminUsersPage.jsx:178` et `269` utilisent `type="text"` pour les mots de passe.

**Correction :** `type="password"`, `autocomplete="new-password"`, bouton afficher/masquer accessible si nécessaire.

#### F-05 — Routes dupliquées et branche morte dans `App.jsx`

Les routes sont dupliquées dans les branches suspendue/normale (`App.jsx:458-520`), alors qu’un retour anticipé sur `showGlobalServerMessage` rend la branche suspendue pratiquement inaccessible. Risque de divergence lors de l’ajout d’une page.

**Correction :** définir une seule table de routes et un seul rendu protégé.

#### F-06 — Une panne de contrôle est présentée comme une suspension métier

`App.jsx:185-207` transforme toute erreur de `loadServiceStatus()` en `serviceSuspended = true`, puis le retour anticipé `App.jsx:432-434` remplace tout le shell par « impossible de joindre le serveur ». L’utilisateur perd alors même l’action de déconnexion. Une panne réseau, un timeout ou une erreur serveur devient indistinguable d’une suspension volontaire.

**Correction :** états séparés `suspended`, `offline`, `timeout`, `sessionExpired` et `serverError`; conserver une action de reconnexion/déconnexion et afficher la dernière donnée connue sans la présenter comme fraîche.

#### F-07 — Erreurs de chargement souvent silencieuses

Plusieurs pages convertissent les erreurs en listes vides ou n’ont pas de `catch` utilisateur : Dashboard véhicules/odomètre, Bons carburant, Bons livraison, Vidanges et règles d’alertes. Une panne fournisseur peut donc ressembler à « zéro donnée ».

**Correction :** état explicite `loading/error/empty/stale`, toast non intrusif, bouton réessayer et journal structuré avec source/âge des données.

#### F-08 — Bundle initial trop lourd

Build observé :

- chunk principal : **747,15 kB minifié / 221,02 kB gzip** ;
- jsPDF : 399,96 kB / 129,66 kB gzip ;
- html2canvas : 199,60 kB / 46,81 kB gzip ;
- CSS principal : 85,08 kB / 20,24 kB gzip.

Vite signale un chunk > 500 kB et un import dynamique inefficace de `src/lib/fleeti.js`. Leaflet/Recharts sont importés au niveau d’`App.jsx`, ce qui alourdit même la route login.

**Correction :** séparer shell/login, dashboard/chart/map, PDF/export ; importer `fleeti` de manière cohérente ; définir les vendor chunks ; mesurer Lighthouse sur mobile réel.

#### F-09 — CSS et pages trop monolithiques

`App.css` contient un design legacy et un design ops empilés ; plusieurs pages dépassent 600-1 000 lignes.

**Correction :** extraction progressive par domaine/composant, tokens uniques, suppression des règles mortes après tests visuels route par route.

#### F-10 — Actions destructives sans protection cohérente

Admin et overrides chauffeurs utilisent le dialogue natif, peu cohérent et difficile à styliser/accessibiliser. Surtout, plusieurs suppressions n’ont aucune confirmation : BL, bons carburant, vidanges, référentiels, déconnexion WhatsApp avec effacement de session et réinitialisation des templates.

**Correction :** modal accessible avec focus trap, nom de l’objet, conséquence et bouton danger explicite.

#### F-11 — Cache PWA des images sensibles

Au-delà de la faille backend, le service worker conserve les uploads. Le logout ne purge pas ces caches.

**Correction :** ne jamais cacher les preuves privées ; versionner et purger correctement les caches applicatifs lors des releases/logout.

#### F-12 — Routes sans garde frontend ni page 404

Le menu masque les entrées selon les permissions, mais toutes les routes restent directement accessibles par URL. Une URL inconnue affiche un shell vide, faute de route `*`.

**Correction :** garde déclarative par permission, écran 403 et route 404 avec retour au dashboard. Le backend reste l’autorité de sécurité.

#### F-13 — Flotte manuelle incohérente selon les écrans

`operationalTrackers` ajoute les unités manuelles pour BL/carburant/vidanges, tandis que Dashboard, carte, Flotte et plusieurs rapports utilisent surtout `enrichedTrackers` API. Totaux et recherches divergent donc selon la page.

**Correction :** une source de flotte normalisée unique, avec champ de provenance et capacités disponibles par tracker.

#### F-14 — Route `/drivers` incorrecte

`/drivers` et `/trackers` montent `FleetPage`, mais le mode est toujours initialisé à `trackers`. Une navigation directe vers `/drivers` affiche « Par camion ».

**Correction :** dériver le mode de l’URL ou supprimer les routes legacy.

#### F-15 — Accessibilité du shell et des composants composites

Le menu mobile n’annonce pas `aria-expanded`, n’a ni focus trap, ni fermeture Escape, ni restauration du focus. Le date picker annonce un dialogue sans rôle/nom correspondant; pagination sans `aria-current`; graphiques sans résumé textuel; plusieurs toasts sans `aria-live`.

**Correction :** compléter les rôles/états ARIA, interactions clavier et tests axe/Testing Library sur menu, date picker, pagination, graphiques et notifications.

---

## 9. Tests, qualité et maintenabilité

### Résultats réels

- **Tests :** 68 réussis, 0 échec, 0 ignoré.
- **Build :** réussi.
- **Lint :** 71 erreurs, 1 warning.

### Analyse de la qualité des tests

La suite couvre de bonnes fonctions pures : normalisation Fleeti, kilométrage, déduplication, rapports chauffeurs, notifications WhatsApp et formatage. Cependant, une partie importante des tests vérifie seulement la présence de chaînes dans le code source avec `readFileSync`.

Il manque notamment :

- tests API HTTP avec authentification et permissions ;
- tests SQLite sur une DB temporaire ;
- tests de redémarrage/persistance ;
- tests transactionnels CRUD complets ;
- test d’accès anonyme aux uploads ;
- test de suppression persistante d’utilisateur ;
- test PATCH Vidanges ;
- tests React DOM/accessibilité ;
- tests navigateur authentifiés mobile/desktop ;
- couverture mesurée.

### Erreurs lint les plus significatives

- `oilChangeUpdateSchema` non défini — bug runtime réel ;
- nombreux imports/fonctions morts dans `server.js` ;
- environnement Node mal configuré dans ESLint (`process`, `Buffer`) ;
- effets React avec `setState` synchrone ;
- dépendance manquante dans `src/hooks.js` ;
- erreurs de variables inutilisées.

**Action :** séparer config ESLint browser/node/service-worker/tests, corriger les vrais défauts puis rendre lint obligatoire en CI.

---

## 10. Production, observabilité et exploitation

### Points positifs

- PM2 exécute le bon cwd et le bon `server.js` ;
- port 8787 en écoute ;
- HTTPS Funnel disponible ;
- Helmet, compression et rate limiting actifs ;
- token d’application obligatoire au démarrage ;
- `.env`, `auth-users.json` et `dist` sont ignorés par Git ;
- identité du dernier commit cohérente avec le propriétaire attendu.

### Lacunes

1. logs très bavards : chaque polling `/api/positions-live` est journalisé ; le log stdout atteint **22,4 Mo / 386 167 lignes** et le log erreur **57,2 Mo / 887 377 lignes**, sans rotation Teliman identifiée ;
2. la télémétrie PM2 observée indique un heap utilisé à environ **88 %** et une latence HTTP p95 proche de **10,7 s**, à investiguer sous charge réelle ;
3. erreurs non structurées, pas d’ID de corrélation ni niveaux JSON ;
4. pas de métriques Prometheus/OpenTelemetry ;
5. aucun contrôle de fraîcheur backup dans la santé ;
6. aucun cron utilisateur ni timer systemd Teliman de sauvegarde identifié ;
7. pas de CI visible imposant lint/test/build/audit ;
8. pas d’alarme sur I/O kernel, échec backup, Fleeti dégradé ou WhatsApp déconnecté ;
9. endpoint health en doublon dans `server.js` (`2454` puis `2826`), source de confusion ;
10. aucun handler `SIGTERM`/`SIGINT` explicite ni checkpoint/fermeture SQLite gracieuse identifié.

---

## 11. Plan d’action priorisé

| Priorité | Action | Effort | Impact |
|---|---|---:|---:|
| P0 | Sauvegarde d’urgence sans redémarrage, puis réparation Netac/EXT4 | M | Critique |
| P0 | Backups quotidiens hors Netac + test restauration | M | Critique |
| P0 | Remplacer le token global et l’identité choisie par en-tête | M | Critique |
| P0 | Supprimer fallback comptes codés en dur | S | Critique |
| P0 | Corriger suppression persistante d’utilisateur | S | Critique |
| P0 | Protéger `/uploads` et retirer cache SW | M | Critique |
| P0 | Ajouter permissions WhatsApp/overrides/assignments | S-M | Critique |
| P0 | Restaurer les données Vidanges/Alertes masquées sur mobile | S-M | Critique UX |
| P1 | Appliquer les permissions aux lectures sensibles + tests de rôles | M | Fort |
| P1 | Corriger `oilChangeUpdateSchema` + test API | S | Fort |
| P1 | Mettre à jour Baileys et React Router, retraiter npm audit | M | Fort |
| P1 | Sessions individuelles expirables en cookie HttpOnly | M-L | Fort |
| P1 | Readiness DB/stockage/Fleeti + alerting | M | Fort |
| P1 | Propager erreurs d’écriture JSON/upload et vérifier persistance | M | Fort |
| P1 | Retirer tous les mocks/fallbackEvents du runtime production | S-M | Fort |
| P1 | Ajouter tests HTTP/SQLite/persistance/permissions | M | Fort |
| P2 | CSP stricte et CORS exact | M | Fort |
| P2 | Pagination SQL et contraintes d’unicité | M | Moyen-fort |
| P2 | Réduire bundle initial et import dynamique inefficace | M | Moyen |
| P2 | Corriger 71 erreurs lint et imposer CI | M | Moyen |
| P2 | Corriger contraste login, champs password et labels mobiles | S | Moyen |
| P3 | Extraire progressivement le monolithe backend/CSS/pages | L | Maintenance |
| P3 | Logs structurés, métriques, traces et tableaux d’alerte | M | Maintenance |

---

## 12. Critères de sortie avant de déclarer la plateforme saine

- [ ] support Netac réparé ou remplacé ; aucun warning EXT4/E/S ;
- [ ] base ouvrable par un nouveau processus et `PRAGMA integrity_check = ok` ;
- [ ] redémarrage PM2 testé après sauvegarde ;
- [ ] sauvegarde hors support restaurée avec succès sur DB temporaire ;
- [ ] aucun compte fallback codé en dur ;
- [ ] suppression utilisateur reste effective après redémarrage ;
- [ ] uploads privés inaccessibles anonymement et non cachés par le SW ;
- [ ] permissions négatives testées pour WhatsApp et chauffeurs ;
- [ ] PATCH Vidanges validé create/read/update/reload/delete ;
- [ ] `npm audit --omit=dev` sans critique/haute non acceptée explicitement ;
- [ ] lint à zéro ; tests + build verts ;
- [ ] aucune donnée mock affichée en production ;
- [ ] health/readiness passe réellement DB, stockage, Fleeti et backups ;
- [ ] audit visuel authentifié desktop + mobile, route par route, sans erreur console/réseau.

---

## Conclusion

Teliman a de bonnes fondations déjà en place : HTTPS, Helmet, compression, rate limit, validation Zod sur plusieurs domaines, SQLite WAL, routes lazy, Error Boundary, responsive et une suite de tests rapide. La plateforme n’est toutefois **pas actuellement exploitable avec un niveau de risque acceptable** tant que le support de données reste en erreur et que les défauts d’authentification, d’autorisations et de confidentialité des uploads ne sont pas corrigés.

La première intervention doit être une **opération de sauvegarde/récupération**, pas un déploiement applicatif.