# Futures implémentations et fonctionnalités Teliman

Ce document centralise les idées de fonctionnalités pertinentes et logiques pour la plateforme Teliman Tracking Fleeti.

## Contexte des échanges

### Message 1 — Demande

L’utilisateur a demandé, sans implémentation immédiate :

> Sans rien implementer dis moi quelles nouvelles fonctionnalités pourraient etre pertinants et logiques pour cette plateforme ?

### Message 2 — Réponse / propositions

Les fonctionnalités proposées ci-dessous constituent une base de backlog produit pour les futures évolutions de la plateforme.

### Message 3 — Sauvegarde demandée

L’utilisateur a ensuite demandé de mettre le contenu dans un fichier `.md` dans le dépôt GitHub et de garder les futures implémentations et fonctionnalités en mémoire pour s’en rappeler.

---

# Idées de fonctionnalités pertinentes

## 1. Alertes intelligentes / centre d’alertes amélioré

### A. Niveau de gravité des alertes

Aujourd’hui toutes les alertes se ressemblent un peu. Il serait pertinent d’avoir :

- **Critique** : excès de vitesse fort, sortie de zone, camion immobilisé longtemps avec BL actif
- **Important** : retard livraison, arrêt prolongé, trajet anormal
- **Info** : départ détecté, arrivée détectée, statut changé

Objectif : ne pas noyer l’utilisateur dans trop de notifications.

### B. Alertes groupées

Au lieu d’envoyer 20 alertes WhatsApp pour le même camion, la plateforme pourrait regrouper :

> Camion X : 7 excès de vitesse détectés entre 14h10 et 14h45.

C’est beaucoup plus lisible.

### C. Règles personnalisables d’alerte

Une page où l’admin choisit :

- vitesse limite par camion ou type de route
- durée minimum de stationnement avant alerte
- horaires où les alertes doivent être actives
- destinataires par type d’alerte

Très logique pour éviter les alertes inutiles.

---

## 2. Gestion avancée des missions / BL

### A. Timeline complète d’un BL

Chaque bon de livraison pourrait avoir une timeline claire :

- BL créé
- camion assigné
- départ détecté
- arrêt intermédiaire
- arrivée zone client
- statut livré
- message WhatsApp envoyé
- carburant lié
- incident éventuel

Ça rend chaque mission très traçable.

### B. Statut automatique du BL

La plateforme pourrait proposer des statuts automatiques :

- **En attente**
- **En route**
- **Arrivé à destination**
- **Livré**
- **Retard probable**
- **Problème détecté**

Basé sur position GPS, destination, temps d’arrêt, etc.

### C. Détection automatique d’arrivée

Si le camion entre dans un rayon autour de la destination, la plateforme pourrait afficher :

> Arrivée probable détectée à 15h42.

Puis l’utilisateur confirme ou non.

---

## 3. Géofencing / zones personnalisées

Très pertinent pour une plateforme logistique.

### A. Zones clients

Créer des zones autour des sites clients :

- port
- usine
- entrepôt
- chantier
- station carburant
- dépôt Teliman

Ensuite la plateforme peut détecter automatiquement :

- entrée dans zone
- sortie de zone
- temps passé sur place

### B. Alertes entrée/sortie de zone

Exemples :

> Camion ABC est arrivé chez Client X.  
> Camion ABC a quitté le dépôt.  
> Camion ABC est sorti de l’itinéraire prévu.

### C. Historique par zone

Voir combien de temps les camions passent à chaque site client ou dépôt.

---

## 4. Prévision de retard / ETA

### A. ETA automatique

Afficher une estimation d’arrivée :

> Arrivée estimée : 16h25  
> Retard probable : +38 min

Même une version simple basée sur distance + vitesse moyenne serait déjà utile.

### B. Alerte retard client

Si le camion est en retard, envoyer automatiquement un WhatsApp au client :

> Bonjour, votre livraison BL-xxx est en cours. Un léger retard est prévu. Nouvelle estimation : 16h25.

Très professionnel.

### C. Comparaison prévu vs réel

Pour chaque BL :

- heure départ prévue
- heure départ réelle
- arrivée prévue
- arrivée réelle
- retard total

Utile pour les rapports.

---

## 5. Rapports opérationnels plus poussés

### A. Rapport performance par camion

Pour chaque camion :

- kilomètres parcourus
- nombre de missions
- temps roulant
- temps arrêté
- excès de vitesse
- consommation carburant estimée
- coût carburant
- rentabilité approximative

### B. Rapport performance chauffeur

Pour chaque chauffeur :

- missions effectuées
- ponctualité
- excès de vitesse
- arrêts longs
- incidents
- score conduite

### C. Rapport client

Pour chaque client :

- nombre de BL
- destinations fréquentes
- délais moyens
- retards
- volume transporté
- chiffre opérationnel si les montants sont ajoutés plus tard

---

## 6. Score de conduite chauffeur

Une fonctionnalité très logique avec les données GPS.

Score calculé selon :

- excès de vitesse
- freinages/arrêts brusques si disponible
- stationnements prolongés
- respect des trajets
- ponctualité
- nombre d’incidents

Exemple :

> Chauffeur : Kouassi  
> Score conduite : 82/100  
> Points faibles : vitesse excessive, arrêts longs

Ça peut devenir un vrai outil de management.

---

## 7. Gestion carburant plus intelligente

### A. Liaison carburant ↔ mission

Quand un bon carburant est créé, le rattacher à :

- camion
- chauffeur
- BL
- destination
- période

Ça permettrait de savoir si le carburant donné correspond réellement à la mission.

### B. Détection d’anomalies carburant

Exemples :

- carburant donné mais camion n’a pas roulé
- carburant très élevé pour courte distance
- plusieurs bons carburant rapprochés
- camion sans mission mais avec carburant

### C. Consommation estimée

Même sans capteur carburant, on peut estimer :

> Distance mission : 280 km  
> Consommation théorique : 95 L  
> Carburant donné : 140 L  
> Écart : +45 L

Très utile pour réduire les pertes.

---

## 8. Documents et pièces jointes

### A. Upload documents par BL

Ajouter sur chaque BL :

- photo bordereau signé
- facture
- preuve livraison
- reçu carburant
- bon client
- photo marchandise

### B. Scan / OCR simple

Plus tard, la plateforme pourrait lire automatiquement :

- référence BL
- nom client
- quantité
- date
- montant

Depuis une photo ou PDF.

### C. Dossier complet mission

Chaque mission aurait son dossier :

> BL + trajet + carburant + WhatsApp + preuve livraison + incidents

Très professionnel.

---

## 9. Notifications client plus avancées

### A. Templates WhatsApp par événement

Au-delà de création et livré :

- départ camion
- arrivée proche
- retard
- livraison confirmée
- document disponible
- problème opérationnel

### B. Historique client WhatsApp

Dans chaque fiche client :

- messages envoyés
- statut envoyé/échec
- dernier BL notifié
- numéro utilisé

### C. Lien de suivi client

Envoyer au client un lien simple :

> Suivre ma livraison

Avec une page publique limitée montrant uniquement :

- statut
- camion en route ou non
- ETA
- contact Teliman

Pas besoin de montrer toute la carte interne.

---

## 10. Tableau de bord direction

Un dashboard synthétique pour le responsable :

- camions actifs aujourd’hui
- missions en cours
- missions terminées
- retards
- alertes critiques
- carburant distribué aujourd’hui
- top chauffeurs
- camions immobilisés
- BL sans camion assigné

Objectif : voir la santé de l’activité en 30 secondes.

---

## 11. Maintenance flotte

Très logique pour une flotte de camions.

### A. Carnet de maintenance par camion

Pour chaque camion :

- vidange
- pneus
- assurance
- visite technique
- réparations
- échéances
- coût maintenance

### B. Alertes échéances

Exemples :

> Visite technique du camion X expire dans 10 jours.  
> Vidange recommandée dans 500 km.

### C. Historique coûts camion

Voir quel camion coûte le plus cher en entretien.

---

## 12. Immobilisation / disponibilité camion

Ajouter un statut opérationnel :

- Disponible
- En mission
- En panne
- En maintenance
- Au dépôt
- Non localisé
- Réservé

Ça aide à savoir rapidement quel camion peut être affecté à une nouvelle mission.

---

## 13. Planification / dispatch

Une page “Planning” où l’on voit :

- BL à assigner
- camions disponibles
- chauffeurs disponibles
- missions du jour
- missions demain
- conflits éventuels

Plus tard : suggestion automatique du meilleur camion selon position/destination.

---

## 14. Recherche globale

Une barre de recherche unique :

Rechercher :

- BL
- client
- camion
- chauffeur
- numéro WhatsApp
- destination
- bon carburant

Très pratique quand les données grossissent.

---

## 15. Journal d’activité admin

Pour la traçabilité :

- qui a créé un BL
- qui a modifié un statut
- qui a supprimé un élément
- qui a envoyé un message test
- qui a changé un template WhatsApp
- qui a ajouté un destinataire d’alerte

C’est important dès qu’il y a plusieurs utilisateurs.

---

## 16. Permissions plus fines

Actuellement il y a déjà des permissions. On pourrait aller plus loin :

- lecture seule
- création BL uniquement
- validation livraison
- accès carburant
- accès WhatsApp
- accès rapports
- accès admin utilisateurs
- accès données sensibles

Très utile si plusieurs rôles utilisent la plateforme : exploitation, direction, comptabilité, dispatch.

---

## 17. Mode “incident”

Sur une mission ou un camion, pouvoir déclarer :

- panne
- accident
- retard client
- problème chargement
- problème déchargement
- route bloquée
- contrôle police/douane
- autre

Avec :

- heure
- lieu
- commentaire
- photo
- notification WhatsApp interne

---

## 18. Analyse trajet prévu vs réel

Si on connaît la destination, la plateforme peut comparer :

- trajet attendu
- trajet réel
- détour
- arrêt non prévu
- distance supplémentaire
- temps perdu

Très utile pour comprendre les coûts et retards.

---

## 19. Exports professionnels

### A. Export Excel

Pour :

- BL
- carburant
- rapports chauffeurs
- rapports camions
- historique WhatsApp
- alertes

### B. Export PDF mission

Un PDF complet pour un BL :

- infos client
- camion/chauffeur
- trajet
- dates
- WhatsApp envoyés
- carburant lié
- preuve livraison

---

## 20. Nettoyage automatique des historiques

Vu le problème de l’historique WhatsApp, il serait logique d’avoir une politique d’archivage :

- garder les 30 derniers jours visibles
- archiver le reste
- supprimer automatiquement les notifications ignorées après X jours
- bouton “Exporter avant nettoyage”

Ça évite que les pages deviennent lourdes.

---

# Priorité recommandée

Si on devait classer les fonctionnalités les plus utiles à court terme :

1. **Géofencing zones clients/dépôt**
2. **Timeline complète par BL**
3. **Statut automatique du BL**
4. **ETA / retard probable**
5. **Rapport performance camion/chauffeur**
6. **Liaison carburant ↔ mission**
7. **Détection anomalies carburant**
8. **Centre d’alertes avec gravité**
9. **Maintenance flotte**
10. **Journal d’activité admin**

Les plus stratégiques : **géofencing + statut automatique BL + carburant lié aux missions**.

Ce trio transforme la plateforme d’un simple dashboard de suivi en véritable outil de pilotage logistique.
