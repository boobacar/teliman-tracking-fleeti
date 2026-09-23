# Teliman Logistique — Options d'alertes (note de call)

_31/08/2026 — Fallcon Tech / Boubacar FALL_

## 1. Ce qui est DÉJÀ en production

Le moteur d'alertes est codé et tourne. Il ne manque que la fiabilisation du **canal d'envoi**.

- Zones (géofences) configurables : dépôt, carrière, chantier, client, zone interdite
- Détection automatique **entrée / sortie** de zone par camion (anti-doublon 60 s)
- Alertes flotte (événements tracker Fleeti)
- Table de destinataires (nom + numéro, activables/désactivables)
- Historique des événements + statut d'envoi, page « Géofences & Alertes »
- File d'envoi : throttling, réessais, plafond quotidien, horaires 07h–21h

> Conséquence : changer de canal = quelques jours, pas un nouveau projet.

## 2. Le problème du canal actuel (WhatsApp non officiel)

Aujourd'hui les envois passent par une connexion WhatsApp par QR code (bibliothèque Baileys).
C'est **non officiel et contraire aux CGU de Meta** :

- Risque réel de **bannissement définitif du numéro** (erreur 463 / déconnexion 403)
- Le numéro banni est perdu, y compris pour l'usage humain
- Aucun recours, aucun SLA, aucune garantie de livraison
- La coupure est silencieuse : les alertes s'arrêtent sans prévenir

Ce canal reste utilisable comme **secours**, jamais comme socle unique d'une exploitation.

## 3. Les options

| Option | Fiabilité | Coût | Délai | Risque ban |
|---|---|---|---|---|
| **A. WhatsApp Cloud API officiel (Meta)** | Élevée (SLA Meta) | ~5 $/mois + ~3–6 FCFA/message | 3–7 j (vérification entreprise) | Nul |
| **B. Telegram (groupe/bot)** | Élevée | Gratuit, illimité | < 1 j | Nul |
| **C. SMS (Orange CI / opérateur)** | Élevée, marche sans internet | ~20–40 FCFA/SMS | 2–5 j | Nul |
| **D. E-mail + notifications dans la plateforme** | Bonne (non temps réel) | Gratuit | < 1 j | Nul |
| **E. WhatsApp non officiel durci (actuel)** | Faible | Gratuit | Déjà là | Élevé |

### A. WhatsApp Cloud API — recommandé pour l'externe
Le canal officiel. Nécessite : compte Meta Business, **numéro dédié jamais utilisé sur WhatsApp**,
vérification de l'entreprise (registre de commerce), messages proactifs via **modèles pré-approuvés**
par Meta (validation 24–48 h). Coût réel pour Teliman : quelques euros par mois.

### B. Telegram — recommandé pour l'équipe interne
Un groupe « Alertes Teliman » où le bot poste en temps réel. Gratuit, illimité, aucun risque de
blocage, mise en place immédiate. Seule contrainte : l'équipe installe Telegram.

### C. SMS — pour le critique et les chauffeurs
Fonctionne sur n'importe quel téléphone, sans internet. À réserver aux alertes critiques à cause
du coût unitaire.

### D. Plateforme + e-mail — la base
Cloche de notifications dans l'application + récapitulatif quotidien par e-mail. Gratuit, sans
dépendance externe. À faire dans tous les cas.

## 4. Recommandation : multicanal par criticité

- **Critique** (sortie de zone interdite, immobilisation anormale, arrêt prolongé, SOS)
  → SMS **+** WhatsApp officiel
- **Important** (entrée/sortie de zone, retard sur un BL, dépassement horaire)
  → WhatsApp officiel **ou** Telegram
- **Informatif** (résumé quotidien, kilométrages, vidanges à prévoir)
  → E-mail + notifications dans la plateforme

Escalade : si le premier destinataire n'accuse pas réception en N minutes, l'alerte remonte au
responsable suivant.

## 5. Décisions attendues de l'équipe Teliman

1. **Liste des événements** qui doivent déclencher une alerte, et lesquels sont critiques
2. **Qui reçoit quoi** : matrice destinataire × type d'alerte (exploitation, direction, chauffeurs)
3. **Horaires** d'envoi et fréquence maximale (anti-spam)
4. **Budget mensuel** accepté pour les canaux payants (WhatsApp officiel / SMS)
5. **Fourniture du numéro dédié** (SIM neuve) et des documents entreprise pour Meta
6. **Telegram** : l'équipe accepte-t-elle de l'installer pour l'interne ?

## 6. Plan proposé

- **Semaine 1** : notifications in-app + e-mail + Telegram interne (immédiat, zéro coût, zéro risque)
- **Semaine 1–2** : dossier Meta Business, numéro dédié, modèles de messages soumis
- **Semaine 2–3** : bascule WhatsApp officiel, canal non officiel désactivé
- **Ensuite** : SMS branché sur les seules alertes critiques, règles d'escalade
