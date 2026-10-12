# Réunion équipe Teliman Logistique — état des plateformes

**Date :** lundi 12 octobre 2026 · **Support :** présentation orale de ce document
**Plateformes concernées :** Teliman Tracking (teliman-tracking-fleeti) · Teliman Share (telimanshare-storage)

---

## 1. Où on en est — les chiffres du jour

### Teliman Tracking (supervision de flotte)

| Élément | État réel au 12/10 |
|---|---|
| Disponibilité | service en ligne, supervision verte (base, stockage, sauvegarde, données GPS) |
| Utilisateurs | **8 comptes réels** : 5 direction/admin, 3 exploitation (+3 comptes techniques) |
| Camions suivis | **7 camions** avec activité ce mois : 3216, 45791, 39151, 4400, 3952, 45792, 3100 (WWCI01) |
| Base d'activité | **174 bons de livraison** (159 livrés), **63 bons carburant**, **1 274 événements de zone** (88 sur 7 jours) |
| Photos de preuve | 24 bons de livraison et 43 bons carburant avec photo jointe |
| Zones surveillées | 4 : Fadyadougou (mine), Korhogo (client), Abidjan (carrière), Bouaké |
| Clients | K1 MINE, LAFARGE, CADERAC Abidjan, APPROTRANS |
| Destinataires d'alertes | 6 numéros WhatsApp (5 internes + contacts clients) |
| Alertes WhatsApp | passerelle Baileys sur le serveur, fenêtre d'envoi 7 h–21 h |

### Teliman Share (partage de documents)

| Élément | État réel au 12/10 |
|---|---|
| Contenu | **169 dossiers, 2 425 fichiers, 873 Mo** |
| Stockage | disque dédié, **202 Go libres** sur 229 Go |
| Accès | authentification stricte, lien privé (Tailscale + tunnel sécurisé) |
| Disponibilité | service en ligne depuis 2,7 jours sans interruption |

### Sauvegardes et hébergement

- Sauvegarde automatique **toutes les nuits à 03 h** (données métier, documents, session WhatsApp) — vérifiée ce matin.
- Tout tourne sur un serveur unique au bureau (Raspberry Pi) : tracking, documents, passerelle WhatsApp, sauvegardes.
- **Attention capacité :** la carte système est à **74 %** (15 Go libres). Les photos de preuve y sont stockées — il faudra une règle de rétention.

---

## 2. Ce qui a été corrigé dernièrement (fiabilité)

- **Alertes WhatsApp fiables** : la session ne se délie plus à chaque redémarrage, les messages non déchiffrés sont renvoyés, les clés de chiffrement ne sont plus supprimées trop tôt.
- **Routage des alertes** : une page permet désormais de choisir **qui reçoit quoi**, par destinataire (entrée/sortie de zone, excès de vitesse, départ/arrivée de mission client, rapports), avec restriction à une zone, un client ou un camion.
- **Aucune alerte perdue au redémarrage** : les messages en attente sont conservés puis renvoyés.
- **Photos des bons de livraison** : elles étaient **rejetées en silence** depuis des mois (l'enregistrement entier échouait). Corrigé et vérifié — les agents peuvent de nouveau joindre leurs preuves (24 bons déjà avec photo depuis).
- **Surveillance renforcée** : 6 contrôles automatiques (passerelle WhatsApp, silence des alertes, disque de documents, sauvegarde, service).
- **Mises à jour visibles immédiatement** : les navigateurs ne rejouent plus l'ancienne version de l'application.

---

## 3. Le point critique du jour — à traiter en priorité

**La passerelle WhatsApp est déconnectée depuis le 8 octobre (4 jours).**

- Conséquence : **256 alertes n'ont pas été délivrées** depuis le 8/10 (entrées/sorties de zone, dont les alertes clients). Les camions ont continué à être suivis, les événements sont enregistrés, mais personne n'a été prévenu.
- Cause : la session liée au téléphone du numéro d'alerte a été invalidée (déliaison). Un **scan du QR code** est nécessaire.
- Remise en route (2 minutes) : ouvrir la page WhatsApp de la plateforme avec le téléphone qui porte le numéro d'alerte, puis « Appareils connectés → Lier un appareil ». La page affiche le QR en direct.
- Ce qu'il faut en tirer : la **détection a fonctionné** (le contrôle automatique a signalé la panne toutes les 30 minutes), mais **personne n'a scanné**. Le problème n'est donc pas technique, il est de **responsabilité** : il faut un responsable de la passerelle et un délai maximum de remise en route.

**Décision attendue :** qui est responsable du numéro d'alerte, et en combien de temps doit-il être rétabli (proposition : 4 heures en heures ouvrées) ?

---

## 4. Ce qui reste fragile (à dire honnêtement)

1. **Dépendance à Fleeti** pour les positions : les données viennent de la plateforme du fournisseur. Un changement de leur côté nous impacte directement. (Un plan de sortie vers notre propre matériel GPS existe — voir §6.)
2. **Aucun historique de positions** stocké chez nous : on sait où sont les camions *maintenant*, pas ce qu'ils ont fait heure par heure. C'est le prérequis des rapports et des estimations d'arrivée.
3. **Aucune règle de routage configurée** à ce jour : tout le monde reçoit les mêmes alertes. La fonctionnalité est prête, il manque le paramétrage (5 minutes de votre côté).
4. **Discipline des bons de livraison** : **15 bons sont encore « En cours »**, avec des dates du 30/09 au 10/10 — donc tous à clôturer. Un bon non clôturé fausse les rapports et laisse croire à des missions actives.
5. **Restauration de sauvegarde jamais rejouée** récemment : on sait que les sauvegardes se font, pas qu'elles se restaurent.
6. **Module Vidanges/entretien** : présent mais **aucune saisie** (0 enregistrement). À utiliser ou à retirer.
7. **Durée de vie de la carte système** : 74 % occupés, photos en croissance.

---

## 5. Prochainement — priorités proposées

### Vague 1 — rapide et à fort effet (2 à 3 semaines)

| Sujet | Ce que ça apporte | Effort |
|---|---|---|
| **Rapport quotidien automatique du directeur** | Un message WhatsApp par jour à heure fixe : missions du jour, ce que chaque camion a fait jusqu'à l'heure d'envoi, bons en cours sans mouvement, anomalies | Moyen |
| **Alertes d'anomalies d'exploitation** | « Bon ouvert depuis 48 h sans mouvement », « camion sans position depuis 3 h », « consommation carburant anormale » — au lieu de découvrir les problèmes par hasard | Faible |
| **Routage des alertes à configurer** | Chacun ne reçoit que ce qui le concerne (direction, exploitation, clients) | 5 min |
| **Règle de clôture des bons** | Alerte automatique sur les bons ouverts trop longtemps, plus de « bons fantômes » | Faible |
| **Test de restauration de sauvegarde** | Garantir qu'on peut tout reconstruire | Faible |

### Vague 2 — la valeur métier (1 à 2 mois)

- **Historique des positions** (enregistrement continu) : prérequis de tout le reste (rapports, ETA, kilométrage réel, preuve de passage).
- **Estimation d'arrivée (ETA)** sur les trajets : dire au client « arrivée estimée à 14 h 30 ».
- **Portail client en lecture seule** : chaque client voit ses missions et ses preuves, sans passer par WhatsApp.
- **Rapports PDF clients programmés** (journalier/hebdomadaire), envoyés automatiquement.

### Vague 3 — les projets structurants (à décider)

- **Boucle WhatsApp entrante** : le chauffeur envoie la photo du bon depuis son téléphone, la plateforme l'attache au bon ; réponse automatique aux clients (positions, documents). Aujourd'hui tout passe par des saisies manuelles et fonctionne mal (c'est la cause de la panne photos de septembre).
- **Application chauffeur (PWA)** : saisie des bons, photos, incidents, en un geste.
- **Sortie de Fleeti / GPS en propre** : plan de migration vers notre matériel (autonomie matérielle, plus de dépendance à la plateforme du fournisseur).
- **Module entretien/vidanges** : plan d'entretien par camion, alertes échéances.

---

## 6. Décisions à prendre en réunion

| # | Sujet | Décision attendue | Qui |
|---|---|---|---|
| 1 | Passerelle WhatsApp | Responsable du numéro + délai de remise en route après une alerte | Direction |
| 2 | Routage des alertes | Valider le principe avant paramétrage (qui reçoit quoi) | Direction + exploitation |
| 3 | Rapport quotidien | Contenu, heure d'envoi, destinataires | Direction |
| 4 | Bons en cours | Qui clôture les 15 bons ouverts, et sous quel délai | Exploitation |
| 5 | Vidanges | On active le module (saisie obligatoire) ou on le retire | Exploitation |
| 6 | Photos : rétention | Combien de temps garde-t-on les preuves (carte système à 74 %) | Direction + IT |
| 7 | Ordre des vagues 2 et 3 | Choisir les deux sujets à lancer en priorité | Direction |
| 8 | GPS en propre | Valider ou non l'étude de sortie de Fleeti | Direction |

---

## 7. Annexe — vérifier en direct pendant la réunion

- **État du service :** page d'état de la plateforme (disponibilité, base, stockage, session WhatsApp).
- **Surveillance en place :** 6 contrôles automatiques — passerelle WhatsApp (10 min), silence des alertes et documents (30 min), disque de documents (15 min), service (5 min), sauvegarde nocturne.
- **Remise en route WhatsApp :** page « WhatsApp » de la plateforme → QR code en direct → « Appareils connectés » sur le téléphone du numéro d'alerte.
- **Preuves de livraison :** bon de livraison → détail → section « Photos du bon de livraison ».
