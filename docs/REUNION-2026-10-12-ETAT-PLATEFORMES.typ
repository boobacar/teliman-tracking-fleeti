// État des plateformes Teliman — document de réunion (PDF premium Typst)
#set page(paper: "a4", margin: (x: 1.3cm, y: 1.2cm), footer: align(center)[#text(size: 8pt, fill: rgb("#6b7280"))[Teliman Logistique · État des plateformes · 12 octobre 2026 · Page #context counter(page).display()]])
#set text(lang: "fr", size: 9.3pt, fill: rgb("#16261a"), font: ("DejaVu Sans", "Liberation Sans"))
#set heading(numbering: none)

#let green = rgb("#1b3a19")
#let green2 = rgb("#23511F")
#let soft = rgb("#eef4ed")
#let copper = rgb("#6f4525")
#let muted = rgb("#5b6b5d")
#let border = rgb("#cfdccf")
#let red = rgb("#b42318")
#let amber = rgb("#b7791f")
#let okgreen = rgb("#138a52")

#let sectionheader(num, title) = [
  #v(9pt)
  #grid(columns: (auto, 1fr), gutter: 8pt, align: horizon)[
    #box(fill: green2, radius: 3pt, inset: (x: 7pt, y: 3pt))[#text(size: 10.5pt, fill: white, weight: "bold")[#num]]
  ][
    #text(size: 14pt, fill: green, weight: "bold", title)
  ]
  #v(2pt)#line(length: 100%, stroke: 0.8pt + border)#v(5pt)
]
// Un titre de section ne doit JAMAIS rester seul en bas de page : on colle le titre
// et sa première unité de contenu dans un bloc insécable.
#let sect(num, title, content) = block(breakable: false)[#sectionheader(num, title) #content]
#let section(num, title) = sectionheader(num, title)

#let card(title, value, note, color: green) = rect(radius: 8pt, fill: white, stroke: 0.6pt + border, inset: 9pt, width: 100%)[
  #text(size: 7.5pt, fill: muted, weight: "semibold", title) \
  #text(size: 15pt, fill: color, weight: "bold", value) \
  #text(size: 7pt, fill: muted, note)
]

#let pill(txt, color) = box(fill: color.lighten(86%), stroke: 0.5pt + color.lighten(40%), radius: 12pt, inset: (x: 6pt, y: 2.5pt))[#text(size: 7.3pt, fill: color.darken(10%), weight: "bold", txt)]
#let th(t) = [#text(weight: "bold", size: 7.9pt, t)]
#let td(t) = [#text(size: 7.9pt, t)]
#let tdw(t) = [#text(size: 7.9pt, weight: "bold", t)]

// ── Bandeau d'en-tête ──
#rect(fill: green2, radius: 12pt, inset: 16pt, width: 100%)[
  #grid(columns: (1fr, 4.1fr), gutter: 14pt, align: horizon)[
    #circle(fill: white, stroke: 1pt + border, inset: 6pt)[#image("teliman-logistique-logo.jpg", width: 58pt)]
  ][
    #text(size: 20pt, fill: white, weight: "bold")[État des plateformes]
    #v(2pt)
    #text(size: 12pt, fill: white.lighten(12%))[Teliman Tracking · Teliman Share]
    #v(4pt)
    #text(size: 8.5pt, fill: white.lighten(20%))[Réunion d'équipe — lundi 12 octobre 2026 · Document de travail, chiffres relevés le jour de la réunion]
  ]
]
#v(9pt)

// ── Chiffres clés ──
#grid(columns: (1fr, 1fr, 1fr, 1fr), gutter: 7pt)[
  #card("Camions suivis", "7", "activité sur le mois")][
  #card("Bons de livraison", "174", "159 livrés")][
  #card("Documents partagés", "2 425", "169 dossiers · 873 Mo")][
  #card("Comptes utilisateurs", "8", "5 direction · 3 exploitation")]
#v(6pt)
#grid(columns: (1fr, 1fr, 1fr, 1fr), gutter: 7pt)[
  #card("Événements de zone", "1 274", "88 sur les 7 derniers jours")][
  #card("Bons carburant", "63", "43 avec photo")][
  #card("Alertes non délivrées", "256", "depuis le 8 octobre", color: red)][
  #card("Espace de stockage libre", "202 Go", "sur le disque documents", color: copper)]

// ── À retenir / action urgente ──
#v(7pt)
#grid(columns: (1.35fr, 1fr), gutter: 10pt)[
  #rect(fill: soft, stroke: 0.7pt + border, radius: 10pt, inset: 11pt)[
    #text(weight: "bold", fill: green)[À retenir]
    #v(3pt)
    #list(
      [Les deux plateformes sont *en ligne* et les camions ont été suivis sans interruption.],
      [Les photos de preuve des bons de livraison, cassées depuis des mois, *fonctionnent de nouveau* (24 bons avec photo depuis la correction).],
      [La surveillance automatique fonctionne : 6 contrôles, dont un qui a signalé la panne WhatsApp toutes les 30 minutes.],
      [*Le point faible n'est plus technique, il est humain* : la panne WhatsApp n'a pas été traitée pendant 4 jours.],
    )
  ]
  #rect(fill: red.lighten(93%), stroke: 0.7pt + red.lighten(55%), radius: 10pt, inset: 11pt)[
    #text(weight: "bold", fill: red)[Action urgente — avant la réunion]
    #v(3pt)
    #text(size: 8.4pt)[La passerelle WhatsApp est déconnectée depuis le *8 octobre*. Scan du QR nécessaire (2 minutes), page WhatsApp de la plateforme, depuis le téléphone du numéro d'alerte.]
  ]
]

// ══ 1. État des plateformes ══
#sect("1", "État des deux plateformes", [

#text(size: 8.6pt, fill: muted)[Chiffres relevés le 12 octobre 2026 sur la plateforme en production.]
#v(4pt)

#grid(columns: (1fr, 1fr), gutter: 11pt)[
  #rect(fill: white, stroke: 0.7pt + border, radius: 9pt, inset: 11pt)[
    #text(weight: "bold", fill: green2)[Teliman Tracking — supervision de flotte]
    #v(4pt)
    #table(columns: (1.5fr, 1.3fr), inset: 4.5pt, stroke: 0.4pt + border,
      tdw("Disponibilité"), td("service en ligne, contrôles verts"),
      tdw("Utilisateurs"), td("8 comptes réels (5 direction, 3 exploitation)"),
      tdw("Camions actifs"), td("3216, 39151, 3952, 4400, 45791, 45792, 3100 WWCI01"),
      tdw("Bons de livraison"), td("174 (159 livrés, 15 en cours)"),
      tdw("Bons carburant"), td("63 (43 avec photo)"),
      tdw("Événements de zone"), td("1 274 au total, 88 sur 7 jours"),
      tdw("Zones surveillées"), td("Fadyadougou (mine), Korhogo, Abidjan (carrière), Bouaké"),
      tdw("Clients"), td("K1 MINE, LAFARGE, CADERAC Abidjan, APPROTRANS"),
      tdw("Alertes WhatsApp"), td("6 destinataires, envois de 7 h à 21 h"),
    )
  ]
  #rect(fill: white, stroke: 0.7pt + border, radius: 9pt, inset: 11pt)[
    #text(weight: "bold", fill: green2)[Teliman Share — partage de documents]
    #v(4pt)
    #table(columns: (1.5fr, 1.3fr), inset: 4.5pt, stroke: 0.4pt + border,
      tdw("Contenu"), td("169 dossiers, 2 425 fichiers, 873 Mo"),
      tdw("Stockage"), td("202 Go libres sur 229 Go"),
      tdw("Accès"), td("authentification stricte, lien privé"),
      tdw("Disponibilité"), td("en ligne depuis 2,7 jours"),
    )
    #v(7pt)
    #text(weight: "bold", fill: green2)[Sauvegardes et hébergement]
    #v(3pt)
    #text(size: 8.4pt)[
      - Sauvegarde automatique *chaque nuit à 3 h* (données métier, documents, session WhatsApp).
      - Tout tourne sur un serveur unique au bureau : tracking, documents, passerelle WhatsApp, sauvegardes.
      - *Capacité à surveiller* : la carte système est à *74 %* (15 Go libres) et les photos de preuve y sont stockées.
    ]
  ]
]
])
// ══ 2. Correctifs ══
#sect("2", "Ce qui a été corrigé dernièrement", [
#table(columns: (0.55fr, 2.3fr), inset: 5pt, stroke: 0.4pt + border,
  table.header(th("Quand"), th("Ce qui a été réparé — et ce que ça change")),
  td("Sept."), td([*Alertes WhatsApp fiables* : la session ne se délie plus à chaque redémarrage, les messages non déchiffrés sont renvoyés, les clés de chiffrement ne sont plus supprimées trop tôt.]),
  td("Sept."), td([*Routage des alertes* : page permettant de choisir qui reçoit quoi (zone, flotte, départs/arrivées de missions, rapports), par destinataire et par client.]),
  td("Sept."), td([*Aucune alerte perdue au redémarrage* : les messages en attente sont conservés sur disque puis renvoyés automatiquement.]),
  td("28/09"), td([*Photos des bons de livraison* : elles étaient rejetées en silence depuis des mois (l'enregistrement complet échouait). Corrigé et vérifié — les agents joignent de nouveau leurs preuves.]),
  td("Sept."), td([*Surveillance renforcée* : 6 contrôles automatiques (passerelle, silence des alertes, disque documents, sauvegarde, service).]),
  td("Sept."), td([*Mises à jour visibles immédiatement* : les navigateurs et téléphones ne rejouent plus l'ancienne version de l'application.]),
)
])
// ══ 3. Point critique ══
#sect("3", "Le point critique du jour : la passerelle WhatsApp", [
#rect(fill: red.lighten(94%), stroke: 0.8pt + red.lighten(45%), radius: 9pt, inset: 12pt)[
  #text(weight: "bold", fill: red, size: 10.5pt)[Déconnectée depuis le 8 octobre — 4 jours]
  #v(4pt)
  #text(size: 8.6pt)[
    - *Conséquence* : *256 alertes n'ont été délivrées à personne* depuis le 8/10 (entrées/sorties de zone, y compris les alertes clients). Les positions et les événements ont continué d'être enregistrés : la donnée existe, mais personne n'a été prévenu.
    - *Cause* : la session a été déliée (appareil invalidé côté WhatsApp). Un scan du QR code est nécessaire.
    - *Remise en route (2 minutes)* : page « WhatsApp » de la plateforme → afficher le QR → sur le téléphone du numéro d'alerte, WhatsApp → *Appareils connectés* → *Lier un appareil* → scanner.
    - *Ce qu'il faut en tirer* : la détection a fonctionné (alerte automatique toutes les 30 minutes). Ce qui a manqué, c'est *un responsable et un délai* de remise en route.
  ]
]
#v(5pt)
#rect(fill: white, stroke: 0.7pt + amber, radius: 9pt, inset: 11pt)[
  #text(weight: "bold", fill: amber)[Décision attendue en réunion]
  #v(3pt)
  #text(size: 8.6pt)[Qui est responsable du numéro d'alerte WhatsApp, et sous quel délai la passerelle doit-elle être rétablie après une alerte ? (proposition : *4 heures* en heures ouvrées, avec espacement des rappels pour éviter le bruit).]
]
])
// ══ 4. Fragilités ══
#sect("4", "Ce qui reste fragile — à assumer devant l'équipe", [
#table(columns: (0.4fr, 1.5fr, 1.6fr), inset: 5pt, stroke: 0.4pt + border,
  table.header(th("#"), th("Point faible"), th("Conséquence concrète")),
  td("1"), td([*Dépendance à Fleeti* pour les positions (plateforme du fournisseur)]), td("Un changement de leur côté nous impacte directement"),
  td("2"), td([*Aucun historique de positions* stocké chez nous]), td("On sait où sont les camions maintenant, pas ce qu'ils ont fait heure par heure : pas de rapport ni d'heure d'arrivée estimée"),
  td("3"), td([*Aucune règle de routage configurée* : tout le monde reçoit tout]), td("Bruit pour la direction, informations sensibles envoyées trop largement"),
  td("4"), td([*15 bons encore « En cours »* (dates du 30/09 au 10/10)]), td("Rapports faussés, missions fantômes, confusion pour l'exploitation"),
  td("5"), td([*Restauration de sauvegarde jamais rejouée* récemment]), td("On sait que les sauvegardes se font, pas qu'elles se restaurent"),
  td("6"), td([*Module Vidanges / entretien inutilisé* (0 saisie)]), td("Fonction présente mais inexploitée : à activer ou à retirer"),
  td("7"), td([*Date de carte système à 74 %*, photos en croissance]), td("Risque de saturation : il faut une règle de conservation des photos"),
)
])
// ══ 5. Feuille de route ══
#sect("5", "Prochainement — priorités proposées", [

#text(weight: "bold", fill: green2)[Vague 1 — rapide et à fort effet (2 à 3 semaines)]
#v(3pt)
#table(columns: (1.45fr, 2.1fr, 0.55fr), inset: 5pt, stroke: 0.4pt + border,
  table.header(th("Sujet"), th("Ce que ça apporte"), th("Effort")),
  td([*Rapport quotidien automatique du directeur*]), td("Un message WhatsApp par jour à heure fixe : missions du jour, ce que chaque camion a fait jusqu'à l'heure d'envoi, bons en cours sans mouvement, anomalies"), td("Moyen"),
  td([*Alertes d'anomalies d'exploitation*]), td("« Bon ouvert depuis 48 h sans mouvement », « camion sans position depuis 3 h », « consommation carburant anormale » — au lieu de découvrir les problèmes par hasard"), td("Faible"),
  td([*Routage des alertes à configurer*]), td("Chacun ne reçoit que ce qui le concerne (direction, exploitation, clients)"), td("5 min"),
  td([*Règle de clôture des bons*]), td("Alerte automatique sur les bons ouverts trop longtemps : plus de bons fantômes"), td("Faible"),
  td([*Test de restauration de sauvegarde*]), td("Garantir qu'on peut tout reconstruire en cas de panne du serveur"), td("Faible"),
)
#v(8pt)
])
#text(weight: "bold", fill: green2)[Vague 2 — la valeur métier (1 à 2 mois)]
#v(3pt)
#table(columns: (1.45fr, 2.65fr), inset: 5pt, stroke: 0.4pt + border,
  table.header(th("Chantier"), th("Contenu")),
  td([*Historique des positions*]), td("Enregistrement continu : prérequis de tous les autres rapports (trajets, kilométrage réel, preuve de passage)"),
  td([*Heure d'arrivée estimée (ETA)*]), td("Annoncer au client « arrivée estimée à 14 h 30 », et alerter en cas de retard"),
  td([*Portail client en lecture seule*]), td("Chaque client consulte ses missions et ses preuves de livraison sans passer par WhatsApp"),
  td([*Rapports PDF clients programmés*]), td("Envoi automatique journalier / hebdomadaire par client"),
)
#v(8pt)
#text(weight: "bold", fill: green2)[Vague 3 — les projets structurants (à décider)]
#v(3pt)
#table(columns: (1.45fr, 2.65fr), inset: 5pt, stroke: 0.4pt + border,
  table.header(th("Chantier"), th("Contenu")),
  td([*Boucle WhatsApp entrante*]), td("Le chauffeur envoie la photo du bon depuis son téléphone, la plateforme l'attache au bon ; réponses automatiques aux clients"),
  td([*Application chauffeur*]), td("Saisie des bons, photos et incidents en un geste, même sans connexion stable"),
  td([*Sortie de Fleeti / GPS en propre*]), td("Migration vers notre propre matériel : plus de dépendance à la plateforme du fournisseur"),
  td([*Module entretien / vidanges*]), td("Plan d'entretien par camion et alertes d'échéance"),
)

// ══ 6. Décisions ══
#sect("6", "Décisions à prendre en réunion", [
#table(columns: (0.35fr, 1.15fr, 2.15fr, 0.6fr), inset: 5pt, stroke: 0.4pt + border,
  table.header(th("#"), th("Sujet"), th("Décision attendue"), th("Qui")),
  td("1"), td("Passerelle WhatsApp"), td("Responsable du numéro + délai de remise en route après une alerte"), td("Direction"),
  td("2"), td("Routage des alertes"), td("Valider qui reçoit quoi (direction, exploitation, clients)"), td("Direction + exploitation"),
  td("3"), td("Rapport quotidien"), td("Contenu, heure d'envoi, destinataires"), td("Direction"),
  td("4"), td("15 bons en cours"), td("Qui les clôture et sous quel délai"), td("Exploitation"),
  td("5"), td("Module vidanges"), td("On active avec saisie obligatoire, ou on le retire"), td("Exploitation"),
  td("6"), td("Conservation des photos"), td("Combien de temps garde-t-on les preuves (carte système à 74 %)"), td("Direction + IT"),
  td("7"), td("Vagues 2 et 3"), td("Choisir les deux chantiers à lancer en priorité"), td("Direction"),
  td("8"), td("GPS en propre"), td("Valider ou reporter l'étude de sortie de Fleeti"), td("Direction"),
)
])
// ══ 7. Annexe ══
#sect("7", "Annexe — à vérifier en direct pendant la réunion", [
#table(columns: (1.25fr, 2.85fr), inset: 5pt, stroke: 0.4pt + border,
  table.header(th("Quoi"), th("Comment")),
  td([*État du service*]), td("Page d'état de la plateforme : disponibilité, base de données, stockage, session WhatsApp"),
  td([*Surveillance en place*]), td("6 contrôles automatiques : passerelle WhatsApp (10 min), silence des alertes et documents (30 min), disque documents (15 min), service (5 min), sauvegarde nocturne à 3 h"),
  td([*Remise en route WhatsApp*]), td("Page « WhatsApp » de la plateforme → QR affiché en direct → « Appareils connectés » sur le téléphone du numéro d'alerte"),
  td([*Preuves de livraison*]), td("Bons livraison → détail d'un bon → section « Photos du bon de livraison »"),
  td([*Documents partagés*]), td("Teliman Share : dossier par client, 2 425 fichiers, accès authentifié"),
)
#v(10pt)
#align(center)[#text(size: 7.5pt, fill: muted)[Document établi le 12 octobre 2026 à partir des données de production — aucun chiffre estimé. Les valeurs « Décision attendue » sont à compléter en séance.]]
])