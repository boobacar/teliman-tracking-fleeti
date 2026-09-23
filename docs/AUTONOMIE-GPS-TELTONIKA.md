# Teliman Logistique — Sortir de Fleeti : matériel GPS propriétaire

**Plan de migration étape par étape**
_Fallcon Tech — Boubacar FALL — 31/08/2026_

---

## 0. Résumé exécutif

Teliman peut devenir **totalement autonome** : ses propres boîtiers GPS, ses propres cartes SIM,
son propre serveur de collecte. La plateforme `teliman-tracking-fleeti` existe déjà et continue de
fonctionner à l'identique — **seule la source des positions change**.

Trois briques à acquérir :

1. **Boîtiers Teltonika** (matériel embarqué dans chaque camion) — achat unique
2. **Cartes SIM M2M** (Orange CI Smart M2M) — abonnement mensuel faible
3. **Serveur de collecte Traccar** (open source) sur VPS — abonnement mensuel faible

Après migration : plus aucune dépendance à Fleeti, données 100 % propriété de Teliman,
coût récurrent quasi nul, et des fonctions que Fleeti ne donne pas (coupure moteur à distance,
sonde carburant, identification chauffeur).

---

## 1. Architecture cible

```
Camion
  └── Boîtier Teltonika (GPS + accéléromètre + entrées/sorties)
        └── Carte SIM M2M (data 4G)
              └── TCP port 5027, protocole "teltonika"
                    └── Serveur Traccar (VPS, IP publique fixe)
                          └── API Traccar (REST + WebSocket)
                                └── Plateforme Teliman existante
                                      (dashboard, carte live, BL, géofences, alertes)
```

**Point d'ingénierie clé** : on introduit dans le backend une **couche d'abstraction
« fournisseur de positions »** avec deux implémentations — `fleeti` et `traccar`. Elles peuvent
tourner **en parallèle** pendant toute la migration, camion par camion, sans jamais couper le
service. C'est ce qui rend la bascule sans risque.

---

## 2. Question préalable qui peut tout changer

> **Les boîtiers déjà installés dans les camions sont-ils des Teltonika, et à qui appartiennent-ils ?**

- **Si ce sont des Teltonika ET qu'ils appartiennent à Teliman** : il suffit de changer l'adresse
  du serveur dans le boîtier (paramètre *Domain* + *Port* du Teltonika Configurator, ou à distance
  par SMS / FOTA Web). **Migration quasi gratuite, en quelques jours, sans acheter de matériel.**
- **Si les boîtiers appartiennent à Fleeti** : ils devront être rendus ou laissés en place, et il
  faut acheter du neuf.

**Action immédiate** : demander à Teliman une **photo de l'étiquette d'un boîtier** (modèle + IMEI)
et **le contrat Fleeti** (durée, préavis de résiliation, clause de propriété du matériel).
Cette seule information fait varier le budget d'un facteur 10.

---

## 3. Choix du matériel Teltonika

| Besoin | Modèle | Commentaire |
|---|---|---|
| Position + contact + coupure moteur (socle) | **FMC920** | 4G LTE Cat 1 avec repli 2G, 3 entrées, 2 sorties. Le remplaçant 1:1 des vieux boîtiers 2G |
| Socle + sonde carburant + lecture CAN | **FMC130** | 4G, 4 entrées, RS232, compatible adaptateur CAN. Le plus vendu, le meilleur compromis |
| Camions lourds : conso réelle, odomètre moteur | **FMC130 + ALL-CAN300** | L'adaptateur ALL-CAN300 couvre ~1 500 modèles dont Mercedes Atego, Volvo FH, Scania, MAN, DAF, et les engins de chantier. Isolation électrique du bus du camion |
| Camion avec tachygraphe numérique | **FMC650** | Modèle dédié poids lourds (J1939 / FMS + tachygraphe) |

⚠️ **Ne pas acheter de FMB (2G/GPRS)** malgré leur prix attractif : le 2G est en extinction
progressive. Prendre la série **FMC (4G avec repli 2G)** pour une durée de vie de 8-10 ans.

### Accessoires utiles (à décider avec Teliman)

- **Relais de coupure moteur** — immobilisation à distance en cas de vol
- **Sonde de niveau carburant LLS** (RS232/RS485) — détection de siphonnage, le vrai poste
  d'économie sur une flotte de bennes
- **iButton / RFID** — identification du chauffeur au démarrage
- **Bouton SOS** — alerte panique chauffeur
- **Antennes externes** — obligatoire sur bennes métalliques et engins de carrière

---

## 4. Coûts réels constatés (août 2026)

### Matériel — distributeur présent en Côte d'Ivoire (Senetic CI)

| Article | Prix net HT |
|---|---|
| Teltonika FMB920 (2G — **non recommandé**) | 20 543 FCFA |
| Teltonika FMC130 (4G) | 61 514 FCFA |
| Adaptateur ALL-CAN300 (estimation) | 60 000 – 90 000 FCFA |
| Sonde carburant LLS (estimation) | 80 000 – 150 000 FCFA |
| Installation par électricien auto (estimation) | 15 000 – 25 000 FCFA / camion |

**Coût installé par camion, configuration standard (FMC130 + pose + câblage + relais)** :
**≈ 90 000 – 110 000 FCFA**, une seule fois.

### Connectivité — Orange CI Smart M2M (tarif public)

| Volume | Prix / SIM / mois |
|---|---|
| 1 à 500 SIM | **800 FCFA** |
| 501 à 1 000 SIM | 650 FCFA |
| > 1 000 SIM | 500 FCFA |

Consommation réelle d'un boîtier : 30 à 60 Mo par mois.

### Serveur

- VPS avec IP publique fixe : **≈ 5 000 – 10 000 FCFA / mois** (le VPS existant peut suffire)
- Logiciel Traccar : **gratuit** (open source, protocole Teltonika natif sur le port 5027)

### Simulation budget

| Taille flotte | CAPEX matériel + pose | OPEX mensuel (SIM + VPS) |
|---|---|---|
| 7 camions (flotte actuellement suivie) | ≈ 700 000 FCFA | ≈ 12 000 FCFA |
| 20 camions | ≈ 2 000 000 FCFA | ≈ 25 000 FCFA |
| 50 camions | ≈ 5 000 000 FCFA | ≈ 50 000 FCFA |

> **Calcul de rentabilité à faire avec Teliman** : il faut leur demander ce qu'ils paient
> aujourd'hui à Fleeti par camion et par mois. Si l'abonnement Fleeti est de X FCFA/camion/mois,
> l'investissement est remboursé en `100 000 / (X − 800)` mois. À 25 000 FCFA/camion/mois chez
> Fleeti, le retour sur investissement est atteint en **4 mois**.

---

## 5. Plan étape par étape

### Phase 0 — Cadrage (semaine 1)

1. Récupérer le **contrat Fleeti** : durée d'engagement, préavis, propriété des boîtiers
2. **Photographier l'étiquette** d'un boîtier installé (marque, modèle, IMEI)
3. **Inventaire réel de la flotte** : nombre de camions, marque/modèle/année de chaque véhicule
   (détermine la compatibilité CAN)
4. Recueillir le **besoin fonctionnel** : quelles données au-delà de la position ? (carburant,
   conso, chauffeur, température, coupure moteur)
5. Demander le **prix Fleeti actuel** par camion → calcul du retour sur investissement
6. **Livrable** : note de décision chiffrée, deux scénarios (reconfiguration des boîtiers existants
   vs achat neuf)

### Phase 1 — Serveur de collecte (semaine 2)

1. Provisionner un **VPS avec IP publique fixe** (ou réutiliser le VPS existant)
2. Installer **Traccar** (Docker), activer le protocole `teltonika` (port TCP 5027)
3. Ouvrir le port 5027 en entrée, durcir le pare-feu (autoriser uniquement les plages opérateur
   si possible)
4. Mettre en place les **sauvegardes** de la base de positions + supervision (uptime, disque)
5. Sécurité : le protocole Teltonika de Traccar n'assure pas TLS nativement — encapsuler derrière
   un proxy TCP avec certificat, ou accepter le flux clair (données non sensibles) selon décision
6. **Livrable** : serveur en ligne, page de statut, procédure de sauvegarde

### Phase 2 — Pilote sur 2 camions (semaines 2-3)

1. Commander **2 boîtiers FMC130 + 2 SIM M2M Orange**
2. Configurer via Teltonika Configurator : APN Orange, domaine = IP du VPS, port 5027,
   protocole TCP, fréquence d'envoi (30 s en roulage / 10 min à l'arrêt)
3. Installer physiquement sur 2 camions (alimentation permanente + détection contact + relais)
4. Déclarer les 2 boîtiers dans Traccar (identifiant = IMEI)
5. **Vérifier sur le terrain pendant 5 à 7 jours** : précision des positions, absence de trous de
   couverture sur l'axe Abidjan – Bouaké – Korhogo – Fadyadougou, consommation data réelle,
   comportement en zone de carrière
6. **Livrable** : rapport de pilote avec traces réelles comparées à Fleeti sur les mêmes trajets

### Phase 3 — Intégration à la plateforme Teliman (semaines 3-4, en parallèle)

1. Créer la couche d'abstraction `positionsProvider` (interface commune `fleeti` / `traccar`)
2. Implémenter le client Traccar : positions live, historique de trajets, événements, odomètre
3. Brancher les modules existants sur la nouvelle source : carte live, tableau de bord,
   **géofences et alertes** (le moteur existe déjà et ne change pas), bons de livraison, rapports
4. Basculer camion par camion via un indicateur en base (`source: fleeti | traccar`)
5. Tests automatisés sur le nouveau fournisseur + double-affichage temporaire pour comparaison
6. **Livrable** : plateforme capable d'afficher les deux sources simultanément

### Phase 4 — Déploiement de la flotte (semaines 5-7)

1. Commander le matériel pour tous les camions restants (+ 10 % de rechange)
2. Planifier les poses par vagues, en profitant des passages à la base (éviter d'immobiliser)
3. Configuration de masse via **FOTA Web** (mise à jour du parc à distance, sans démontage)
4. Contrôle qualité après chaque pose : remontée de position, détection de contact, coupure moteur
5. **Livrable** : tableau de suivi des poses, 100 % des camions visibles sur la nouvelle source

### Phase 5 — Sortie de Fleeti (semaine 8)

1. **Exporter tout l'historique Fleeti** avant résiliation (trajets, kilométrages, rapports) et
   l'archiver dans la base Teliman — c'est irréversible une fois le contrat clos
2. Faire tourner **les deux systèmes en parallèle 30 jours** (double run) pour comparer
3. Envoyer le **préavis de résiliation** selon les termes du contrat
4. Retirer le code et les identifiants Fleeti de la plateforme
5. **Livrable** : plateforme 100 % autonome, historique conservé, dépendance externe supprimée

---

## 6. Ce que Teliman gagne en plus

Fonctions impossibles ou payantes chez Fleeti, disponibles immédiatement avec du matériel propre :

- **Immobilisation à distance** du camion (relais de coupure) en cas de vol
- **Détection de siphonnage carburant** par sonde de niveau — souvent le premier poste de perte
- **Consommation réelle et odomètre moteur** lus sur le bus CAN, pas estimés par GPS
- **Identification du chauffeur** par badge au démarrage
- **Bouton SOS** chauffeur
- **Fréquence de remontée choisie par Teliman** (pas imposée par un forfait)
- **Propriété totale des données** — aucune donnée d'exploitation chez un tiers
- **Aucune facture par véhicule** : ajouter un camion coûte le prix d'un boîtier, pas un abonnement

---

## 7. Risques et parades

| Risque | Parade |
|---|---|
| Boîtiers actuels propriété de Fleeti | Vérifier le contrat en Phase 0 avant tout achat |
| Serveur unique = point de panne | VPS supervisé + sauvegardes + miroir de secours sur le Pi |
| Perte de l'historique à la résiliation | Export complet **avant** d'envoyer le préavis (Phase 5.1) |
| Couverture réseau en zone de mine/carrière | Le boîtier stocke en mémoire flash et renvoie dès le retour du réseau — validé en Phase 2 |
| Mauvaise pose électrique | Passer par un électricien auto qualifié + contrôle qualité systématique |
| Extinction du 2G | N'acheter que des modèles 4G (série FMC) |
| Vol / sabotage du boîtier | Alerte de débranchement (`unplug detection`) + batterie de secours intégrée |

---

## 8. Décisions attendues de Teliman

1. Fournir le **contrat Fleeti** et la **photo d'un boîtier installé**
2. Communiquer le **coût actuel** payé à Fleeti (par camion, par mois)
3. Valider le **nombre exact de camions** à équiper
4. Choisir le niveau d'équipement : socle seul, + sonde carburant, + lecture CAN
5. Valider le **budget CAPEX** et le calendrier de pose
6. Désigner un **référent atelier** côté Teliman pour l'installation physique
