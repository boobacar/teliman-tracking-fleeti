# Raspberry Pi 5 : avantages et évolutions futures pour Teliman

Ce document reprend la discussion sur l’intérêt de faire tourner le projet **teliman-tracking-fleeti** sur un **Raspberry Pi 5 avec 16 GB de RAM**, ainsi que les pistes d’évolution possibles pour la plateforme Teliman.

## Contexte

Le backend Teliman peut tourner sur le Raspberry Pi 5, avec les données runtime stockées sur le disque USB Netac monté sur le serveur. Cette architecture permet de transformer le Pi en petit serveur central Teliman, capable d’héberger l’API, les données, les automatisations, les alertes et les notifications WhatsApp.

## Avantages principaux

### 1. Moins de dépendance au VPS

Avec le backend sur le Raspberry Pi :

- les données restent physiquement sous contrôle Teliman ;
- la plateforme dépend moins d’un serveur loué ;
- les redémarrages, maintenances et tests sont plus simples à maîtriser ;
- le VPS peut devenir un simple secours, relais temporaire ou point de bascule.

Cette approche donne plus de contrôle sur l’infrastructure.

### 2. Coût très faible sur le long terme

Le Raspberry Pi consomme peu d’électricité par rapport à un serveur classique. Pour les besoins actuels de Teliman, il est largement capable de gérer :

- l’API backend ;
- le stockage JSON/runtime ;
- les notifications WhatsApp ;
- la récupération de données Fleeti ;
- les dashboards ;
- les rapports ;
- les tâches automatiques.

Les **16 GB de RAM** donnent beaucoup de marge pour l’évolution du projet.

### 3. Données locales et mieux maîtrisées

Les données Teliman sont sensibles :

- bons de livraison ;
- clients ;
- chauffeurs ;
- destinations ;
- bons carburant ;
- historiques WhatsApp ;
- alertes flotte ;
- données de tracking.

Les héberger sur le Pi, avec un stockage dédié comme `/mnt/netac-storage/teliman-data`, permet de séparer proprement le code applicatif et les données métier.

### 4. Base solide pour automatiser l’entreprise

Le Pi peut devenir un serveur interne Teliman fonctionnant 24h/24 :

- backend Teliman ;
- moteur d’alertes ;
- serveur de notifications WhatsApp ;
- stockage de documents ;
- sauvegardes automatiques ;
- rapports programmés ;
- synchronisation Fleeti ;
- tâches automatiques de contrôle.

Il ne sert donc pas seulement à héberger le site, mais peut devenir une vraie plateforme d’automatisation logistique.

### 5. Accès interne et accès distant sécurisé

Même si le domaine public ou Vercel rencontre un problème, le Pi peut rester accessible :

- en local ;
- via Tailscale ;
- via Tailscale Funnel si l’exposition publique est activée ;
- via un relais VPS temporaire si nécessaire.

Cela donne plusieurs options de continuité.

### 6. Beaucoup de marge avec 16 GB RAM

Pour Teliman aujourd’hui, 16 GB de RAM est confortable. Cette capacité permet d’ajouter plus tard :

- PostgreSQL ;
- Redis ou un système de cache ;
- des workers d’analyse ;
- des scripts d’automatisation ;
- des sauvegardes compressées ;
- du traitement de documents ;
- de l’OCR ;
- de la génération de rapports PDF ;
- une petite couche d’IA locale ou assistée.

Le Raspberry Pi devient donc une plateforme évolutive, pas uniquement un petit serveur web.

## Évolutions futures possibles

### 1. Mettre une vraie base de données

À moyen terme, les données runtime peuvent être migrées vers une base plus robuste :

- **PostgreSQL** pour les BL, clients, carburants, missions, alertes et historiques ;
- **SQLite** si l’objectif est de rester simple et léger.

Avantages :

- meilleure fiabilité ;
- meilleur historique ;
- recherches plus rapides ;
- meilleure gestion multi-utilisateur ;
- moins de risque de corruption des fichiers JSON.

### 2. Sauvegardes automatiques

Le Pi peut programmer des sauvegardes régulières :

- backup quotidien des données Teliman ;
- backup vers le disque USB ;
- backup vers un stockage externe comme Google Drive, S3, Dropbox ou autre ;
- archive hebdomadaire compressée ;
- restauration rapide en cas de problème.

Exemple : tous les soirs, sauvegarder les BL, bons carburant, master-data, uploads et historiques WhatsApp.

### 3. Alertes intelligentes

Le Pi peut devenir un moteur d’alertes avancées :

- excès de vitesse ;
- stationnement excessif ;
- véhicule hors zone ;
- retard de livraison ;
- chauffeur non assigné ;
- BL sans statut ;
- carburant anormal ;
- véhicule inactif ;
- mission commencée mais non terminée ;
- client non notifié.

Les alertes peuvent être envoyées par WhatsApp, Telegram, email ou affichées dans le dashboard.

### 4. Géofencing

Créer des zones métier :

- dépôt Teliman ;
- clients ;
- zones portuaires ;
- zones de livraison ;
- zones interdites ;
- stations-service partenaires.

Le système pourrait détecter automatiquement :

- entrée dans une zone ;
- sortie d’une zone ;
- temps passé sur site ;
- livraison probablement effectuée ;
- retard inhabituel.

### 5. Timeline automatique des BL

Avec Fleeti + Teliman, on peut rapprocher les positions GPS et les données de livraison pour générer une timeline automatique :

- BL créé ;
- camion assigné ;
- camion parti ;
- arrivé chez le client ;
- stationné chez le client ;
- livraison estimée terminée ;
- livré confirmé ;
- notification client envoyée.

Cela permettrait d’avoir un suivi plus opérationnel et moins manuel.

### 6. Rapports automatiques

Le Pi peut produire et envoyer automatiquement :

- rapport journalier flotte ;
- rapport hebdomadaire carburant ;
- rapport mensuel par chauffeur ;
- performance par véhicule ;
- livraisons par client ;
- retards ;
- kilomètres parcourus ;
- consommation estimée ;
- anomalies.

Exemple : chaque matin à 7h, envoyer au manager un résumé des livraisons prévues, véhicules actifs, alertes critiques et BL en retard.

### 7. Détection d’anomalies carburant

Le système peut croiser :

- bons carburant ;
- kilométrage ;
- missions ;
- tracking GPS ;
- chauffeur ;
- véhicule.

Objectifs possibles :

- détecter un carburant pris sans mission ;
- repérer un montant trop élevé ;
- identifier une consommation anormale ;
- trouver des bons carburant répétés ;
- signaler un véhicule qui n’a pas roulé après carburant ;
- comparer distance réelle et carburant consommé.

C’est une des évolutions les plus utiles pour le contrôle opérationnel.

### 8. Centre d’alertes complet

Créer une page dédiée aux alertes :

- alertes ouvertes ;
- alertes traitées ;
- priorité haute, moyenne ou faible ;
- assignation à un utilisateur ;
- historique ;
- commentaires ;
- résolution.

Cela transformerait les alertes en vrai outil de suivi et de décision.

### 9. Maintenance véhicules

Ajouter un module maintenance :

- vidanges ;
- pneus ;
- assurances ;
- visites techniques ;
- entretiens périodiques ;
- documents véhicules ;
- rappels automatiques ;
- historique des réparations ;
- coûts par véhicule.

Le Pi pourrait envoyer les rappels automatiquement.

### 10. Mode offline/local

À terme, une partie de la plateforme pourrait rester accessible localement même en cas de problème internet. Ce mode peut être utile pour continuer à consulter certaines données internes ou garder un minimum d’activité.

### 11. Tableau TV / écran de supervision

Le Raspberry Pi peut alimenter un écran de supervision affichant :

- carte flotte ;
- véhicules actifs ;
- alertes ;
- BL du jour ;
- retards ;
- statut WhatsApp ;
- santé du système.

Cela donnerait un vrai écran de dispatch/logistique.

### 12. Monitoring technique

Le Pi peut surveiller sa propre santé :

- température CPU ;
- espace disque ;
- RAM ;
- statut PM2 ;
- statut backend ;
- statut WhatsApp ;
- état Tailscale Funnel ;
- réussite ou échec des sauvegardes.

Une alerte peut être envoyée si un service tombe ou si le disque commence à être plein.

## Feuille de route recommandée

Le meilleur chemin d’évolution pourrait être :

1. stabiliser l’hébergement Raspberry Pi ;
2. mettre en place les sauvegardes automatiques ;
3. migrer progressivement les données vers une vraie base ;
4. construire les alertes métier ;
5. ajouter les rapports automatiques ;
6. ajouter le géofencing et les détections d’anomalies ;
7. faire du Pi le centre opérationnel Teliman.

## Conclusion

Le Raspberry Pi 5 avec 16 GB de RAM est largement suffisant pour les besoins actuels de Teliman. Son vrai intérêt est de devenir progressivement le **serveur central Teliman** : données, automatisations, alertes, rapports, WhatsApp, tracking, sauvegardes et supervision.

Ce n’est donc pas seulement un hébergement moins cher. C’est une base solide pour construire une plateforme logistique intelligente et maîtrisée.
