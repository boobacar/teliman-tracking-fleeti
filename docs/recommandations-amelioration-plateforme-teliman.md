# Recommandations d’amélioration — Plateforme Teliman Tracking Fleeti

**Date :** 28 juillet 2026  
**Projet :** Teliman Tracking Fleeti  
**Objectif :** Faire évoluer la plateforme d’un tableau de suivi vers un véritable système d’exploitation logistique.

---

## Synthèse

La plateforme possède désormais une base technique solide. La priorité ne doit plus être d’ajouter de nombreux écrans isolés, mais de transformer les données Fleeti en outils opérationnels utilisés quotidiennement par l’exploitation.

Les meilleurs investissements sont :

1. unifier la production et le déploiement ;
2. transformer la Live Map en poste de contrôle ;
3. unifier camion, chauffeur, BL, mission et preuves ;
4. rendre les alertes réellement actionnables ;
5. fiabiliser la qualité des données et la supervision.

---

## 1. Unifier réellement la production

Deux versions de l’application peuvent actuellement diverger :

- `https://teliman-tracking-fleeti.vercel.app` ;
- `https://home-server-1.tail660cfd.ts.net`.

Il faut définir une architecture officielle :

- **Vercel pour le frontend avec une API Teliman sécurisée**, ou
- **application complète sur le serveur Teliman**, avec le Funnel HTTPS comme domaine principal.

### Améliorations recommandées

- choisir une seule URL officielle de production ;
- automatiser et versionner les déploiements ;
- afficher la version ou le commit déployé dans l’administration ;
- disposer d’un environnement de préproduction ;
- exécuter les scénarios E2E avant chaque mise en production ;
- conserver un mécanisme simple de retour au build précédent ;
- vérifier l’identité GitHub autorisée avant chaque déploiement Vercel.

### Résultat attendu

Une correction validée ne doit jamais être visible sur un domaine et absente de l’autre sans que cela soit explicitement annoncé.

---

## 2. Transformer la Live Map en poste de contrôle

La Live Map est l’écran ayant le plus fort potentiel opérationnel.

### Fonctionnalités prioritaires

- panneau latéral sur ordinateur et bottom sheet sur mobile ;
- âge exact de la dernière position : `il y a 12 s`, `il y a 8 min` ;
- état GPS, connexion, vitesse, chauffeur et mission active ;
- suivi automatique d’un camion en déplacement ;
- action pour suspendre ou reprendre le suivi ;
- regroupement des marqueurs lorsque la flotte augmente ;
- recherche par camion, chauffeur, BL ou client ;
- recentrage individuel et recentrage global de la flotte ;
- affichage du trajet avec son sens de circulation ;
- lecture animée du trajet dans le temps ;
- identification des temps d’arrêt et zones de stationnement ;
- lien direct vers la fiche camion et le BL actif ;
- itinéraire jusqu’à la destination du BL ;
- estimation de distance et d’heure d’arrivée ;
- état explicite des tuiles cartographiques et possibilité de réessayer.

### Géofences

Ajouter des zones métier configurables :

- dépôts ;
- carrières ;
- chantiers ;
- sites clients ;
- zones interdites.

Ces zones permettraient de détecter automatiquement :

- entrée ou sortie de site ;
- arrivée chez le client ;
- temps d’attente ;
- durée de chargement ;
- durée de déchargement ;
- départ non autorisé ;
- immobilisation anormale.

---

## 3. Créer un workflow métier unifié de mission

Le BL, le camion, le chauffeur et la position doivent former un workflow unique.

### Cycle recommandé

1. BL créé ;
2. camion et chauffeur affectés ;
3. mission envoyée ;
4. départ du chauffeur ;
5. arrivée au chargement ;
6. départ du chargement ;
7. arrivée chez le client ;
8. livraison confirmée ;
9. photos et signature enregistrées ;
10. mission clôturée.

### Contenu d’une mission

Chaque mission devrait regrouper :

- une timeline complète ;
- le BL correspondant ;
- le camion et le chauffeur ;
- l’origine et la destination sur la carte ;
- les preuves photo ;
- la signature ou validation de réception ;
- les messages WhatsApp envoyés ;
- les incidents et alertes ;
- les bons carburant associés ;
- les kilomètres parcourus ;
- les temps d’arrêt ;
- les durées prévues et réelles ;
- les écarts et retards.

Cette évolution ferait passer la plateforme d’un outil de consultation à un véritable système d’exploitation logistique.

---

## 4. Rendre les alertes actionnables

Une alerte ne doit pas seulement être affichée. Elle doit être traitée et suivie.

### Cycle d’une alerte

- nouvelle ;
- reconnue ;
- en traitement ;
- résolue.

### Informations nécessaires

- niveau de priorité ;
- responsable assigné ;
- commentaire d’exploitation ;
- date de prise en charge ;
- date de résolution ;
- lien vers le camion ;
- position cartographique ;
- historique des actions ;
- règles d’escalade.

### Automatisations utiles

- excès de vitesse critique → notification immédiate ;
- arrêt anormal prolongé → avertissement exploitation ;
- perte GPS prolongée → alerte technique ;
- baisse anormale de carburant → suspicion de fraude ;
- déplacement sans BL actif → anomalie opérationnelle ;
- sortie de l’itinéraire prévu → notification ;
- arrivée chez le client → notification ou message WhatsApp.

Les alertes identiques provenant du même incident doivent être regroupées afin d’éviter le bruit opérationnel.

---

## 5. Créer un tableau d’exploitation journalier

Le Dashboard doit soutenir la réunion et le suivi quotidien.

### Indicateurs recommandés

- camions actifs ;
- camions disponibles ;
- camions immobilisés ;
- missions en cours ;
- missions en retard ;
- livraisons terminées aujourd’hui ;
- camions hors ligne ;
- alertes non traitées ;
- consommation anormale de carburant ;
- vidanges à prévoir ;
- chauffeurs actifs ;
- kilomètres parcourus aujourd’hui.

Chaque indicateur doit ouvrir la liste filtrée correspondante. Aucun KPI ne devrait être uniquement décoratif.

---

## 6. Renforcer la qualité des données

Les relations métier doivent être vérifiées et explicites :

- camion ↔ tracker ;
- tracker ↔ chauffeur ;
- camion ↔ BL ;
- BL ↔ client ;
- BL ↔ bons carburant ;
- camion ↔ vidanges ;
- chauffeur ↔ historique de missions.

### Page « Qualité des données »

Cette page pourrait signaler :

- trackers sans camion ;
- camions sans tracker ;
- chauffeurs non assignés ;
- doublons ;
- positions trop anciennes ;
- BL sans destination exploitable ;
- clients sans téléphone ;
- documents manquants ;
- odomètres incohérents ;
- missions actives incompatibles ;
- référentiels incomplets.

---

## 7. Faire évoluer les rapports en outils décisionnels

### Améliorations recommandées

- filtres enregistrables ;
- comparaison avec la période précédente ;
- classement des chauffeurs ;
- coût et consommation par camion ;
- coût par kilomètre ;
- temps d’immobilisation ;
- ponctualité des livraisons ;
- délai moyen par client ;
- taux d’utilisation des véhicules ;
- anomalies de carburant ;
- export PDF et Excel contextualisé ;
- affichage systématique de la source et de la fraîcheur des données ;
- génération automatique d’un rapport quotidien ou hebdomadaire.

---

## 8. Optimiser l’expérience mobile

La plateforme doit être réellement exploitable sur le terrain.

### Améliorations prioritaires

- carte occupant l’essentiel de l’écran ;
- fiche camion sous forme de bottom sheet ;
- actions principales accessibles au pouce ;
- navigation basse ne masquant jamais le contenu ;
- mode chauffeur simplifié ;
- prise de photos et confirmation de livraison en moins de trois actions ;
- compression maîtrisée des images ;
- fonctionnement dégradé lorsque le réseau est faible ;
- synchronisation après rétablissement de la connexion ;
- messages d’erreur et états offline explicites.

Les données métier et médias privés ne doivent jamais être mis en cache sans protection.

---

## 9. Faire évoluer le temps réel

Le polling fonctionne, mais peut devenir coûteux avec davantage de véhicules et d’utilisateurs.

### Évolution recommandée

- SSE ou WebSocket pour les positions ;
- transmission uniquement des positions modifiées ;
- arrêt automatique lorsque l’onglet est masqué ;
- reprise après reconnexion ;
- indicateur de retard par véhicule ;
- fallback par polling si le canal temps réel est indisponible ;
- absence de requêtes concurrentes ;
- métriques de latence et de fraîcheur.

---

## 10. Mettre en place une supervision continue

### Contrôles automatiques recommandés

- test de connexion ;
- contrôle de chargement des tuiles ;
- test Live Map sur ordinateur et mobile ;
- sélection et recentrage d’un camion ;
- test du tracé sur 48 heures ;
- contrôle de la console et des erreurs réseau ;
- surveillance de l’API Fleeti ;
- surveillance des temps de réponse ;
- alerte si le stockage passe en lecture seule ;
- vérification des sauvegardes ;
- exercice périodique de restauration ;
- contrôle de santé après chaque déploiement.

---

## Ordre de priorité recommandé

### Priorité 1 — Production

- unifier l’URL officielle ;
- définir le mécanisme de déploiement ;
- ajouter version, préproduction et rollback.

### Priorité 2 — Live Map

- suivi du camion ;
- panneau de détails ;
- destination et ETA ;
- géofences ;
- lecture des trajets.

### Priorité 3 — Missions

- connecter BL, camion, chauffeur, destination et preuves ;
- ajouter une timeline opérationnelle ;
- automatiser les changements de statut fiables.

### Priorité 4 — Alertes

- assignation ;
- traitement ;
- résolution ;
- escalade ;
- notifications ciblées.

### Priorité 5 — Pilotage

- Dashboard journalier ;
- qualité des données ;
- rapports décisionnels ;
- rapports automatiques.

### Priorité 6 — Industrialisation

- vrai temps réel ;
- supervision ;
- tests E2E continus ;
- exercices de restauration.

---

## Recommandation finale

Il est déconseillé d’ajouter maintenant davantage de graphiques décoratifs ou de pages isolées.

Le meilleur investissement consiste à relier plus étroitement :

- la carte ;
- les missions ;
- les bons de livraison ;
- les chauffeurs ;
- les véhicules ;
- le carburant ;
- les preuves ;
- les alertes.

La cible doit être un workflow opérationnel unique, mesurable et traçable, utilisable aussi bien par l’exploitation sur ordinateur que par les équipes terrain sur mobile.
