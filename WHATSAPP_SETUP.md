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
```

Puis : `pm2 restart teliman-tracking-fleeti --silent`

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
