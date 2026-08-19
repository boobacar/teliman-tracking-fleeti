# WhatsApp Cloud API officielle (Meta) — guide de mise en service

L'intégration est implémentée et prête. Le serveur tourne encore en mode `baileys`
(le `.env` actuel définit `WHATSAPP_PROVIDER=baileys`). Pour basculer sur l'API
officielle Meta, suivez ce guide.

## 1. Prérequis Meta (20-30 min, une fois)

1. Créez un **compte Meta Business** sur business.facebook.com (ex. « Teliman Logistique »).
2. Dans **WhatsApp Manager** (business.facebook.com/wa-manager) :
   - **Ajoutez un numéro dédié** (SIM de société). Coût : ~5 $/mois.
   - Activez la **Cloud API** pour ce numéro → vous obtenez :
     - `WHATSAPP_PHONE_NUMBER_ID` (id du numéro)
     - `WHATSAPP_ACCESS_TOKEN` (jeton système, durées variables → régénérez régulièrement)
   - Notez l'ID du **WABA** (business account).

## 2. Créer le template générique (obligatoire pour les envois hors fenêtre 24 h)

Meta rejette les messages texte libres hors fenêtre de conversation de 24 h (erreur `131047`).
Le système bascule automatiquement sur un template **à 1 variable** qui reçoit le message complet :

- Nom : **`teliman_notification`**
- Langue : `fr`
- Catégorie : `Transactionnelle` (approbation quasi immédiate)
- Corps : **`{{1}}`**
- (Facultatif) Bouton « Voir sur la carte » : `https://<votre-domaine>/map`

## 3. Variables à ajouter au `.env` (dossier du projet, hors Git)

```bash
WHATSAPP_PROVIDER=meta
WHATSAPP_NOTIFICATIONS_ENABLED=true
WHATSAPP_ACCESS_TOKEN=<jeton système Meta>
WHATSAPP_PHONE_NUMBER_ID=<id du numéro>
WHATSAPP_DEFAULT_TEMPLATE_NAME=teliman_notification
WHATSAPP_TEMPLATE_LANGUAGE=fr
WHATSAPP_WEBHOOK_VERIFY_TOKEN=<phrase secrète au choix, ex. teliman-wa-2026>
WHATSAPP_QUEUE_ENABLED=true
WHATSAPP_SEND_HOURS_START=7
WHATSAPP_SEND_HOURS_END=21
```

Puis : `pm2 restart teliman-tracking-fleeti --silent`

## 3bis. Protections anti-ban Baileys (mode actuel)

Le mode `WHATSAPP_PROVIDER=baileys` (transitoire) applique toutes les mitigations :

| Protection | Paramètre | Valeur actuelle |
|---|---|---|
| Jitter « humain » entre messages | `minIntervalMs` de la file Baileys | 3-6 s aléatoire (~13 msg/min) |
| Échauffement numéro (warm-up) | `makeWarmupDailyLimit` | 30/j → +20/j → plafond 150/j |
| Circuit-breaker | `circuitBreaker` | pause 10 min après 5 échecs consécutifs |
| Erreur 463 (Reachout Timelock) | `sendText` | **jamais retentée** + cooldown 24 h par destinataire |
| Cooldown 463 | `WHATSAPP_BAILEYS_463_COOLDOWN_HOURS` | 24 h (défaut) |
| Simulation de frappe | `WHATSAPP_BAILEYS_TYPING` | true — presence `composing` + délai 400-1200 ms avant envoi |
| Fenêtre horaire naturelle | `WHATSAPP_SEND_HOURS_START/END` | 7 h → 21 h (heure serveur = Africa/Abidjan). Les notifications BL hors fenêtre attendent l'ouverture ; les **alertes flotte/géofence passent toujours** (`deferrable: false`). |
| Session révoquée (403) | `connection.update` | arrêt de la reconnexion, re-scan QR requis |
| Reconnexion | backoff exponentiel | 5 s → ×2 → max 5 min, 10 tentatives max |

## 4. Webhook (réponses + fenêtre 24 h + accusés)

Dans WhatsApp Manager → Configuration → Webhook :
- **URL de rappel** : `https://<votre-domaine>/api/whatsapp/webhook`
- **Token de vérification** : la valeur de `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- Abonnez-vous aux champs : `messages` (requis), `message_template_status_update`, `account_alerts`.

Effets automatiques une fois actif :
- Un message entrant d'un contact ouvre sa **fenêtre de 24 h** → les réponses passent en texte libre (gratuit).
- Les **échecs d'envoi** (statuts `failed`) sont journalisés avec le code d'erreur Meta.

## 5. Vérification

- Page WhatsApp du site : panneau « Cloud API officielle (Meta) » doit afficher
  « Oui — prête à envoyer » et le webhook « Configuré ».
- `curl http://127.0.0.1:8787/api/whatsapp/status` (avec session) → `cloudApiConfigured: true`.
- Test d'envoi : page WhatsApp → bouton envoyer un message test (passe par la file d'attente).

## 6. File d'attente et quotas (déjà actifs)

- Débit : **1 message / s** (limite Meta en phase de démarrage).
- Plafond journalier : **250 conversations uniques/jour** — au-delà, les envois restent en file
  et reprennent le lendemain (visible dans la page WhatsApp).
- 2 tentatives automatiques en cas d'échec API transitoire.

## 7. Coûts

- Numéro : ~5 $/mois.
- Messages template : ~0,004-0,009 $/message (Côte d'Ivoire ~0,006 $).
- Messages en fenêtre de conversation : gratuits.

## 8. Retrait de Baileys

Une fois Meta validé de bout en bout, supprimez du `.env` :
`WHATSAPP_PROVIDER=baileys` et `WHATSAPP_BAILEYS_AUTH_DIR` (le QR ne sera plus proposé).
Le mode Baileys reste disponible pour le développement local uniquement.
