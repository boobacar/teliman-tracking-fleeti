// Rapport bus TELIMAN LOGISTIQUE — version PDF officielle (demande de l'exploitation :
// activité, vitesses, kilométrage, alertes, rappel de vidange, trajets du jour).
//
// Données : fichier JSON passé en entrée
//   typst compile --root / --input data=bus-data.json rapport-bus.typ rapport-bus.pdf
#let data = json(sys.inputs.data)

#let accent = rgb("#6f4525")
#let accent-clair = rgb("#f3ece5")
#let gris = rgb("#5c5f66")
#let trait = rgb("#d8d3cd")
#let alerte = rgb("#8a2b12")

#set page(
  paper: "a4",
  margin: (x: 16mm, top: 14mm, bottom: 16mm),
  footer: context [
    #set text(size: 8pt, fill: gris)
    #line(length: 100%, stroke: 0.4pt + trait)
    #v(2pt)
    #grid(
      columns: (1fr, 1fr),
      align: (left, right),
      [TELIMAN LOGISTIQUE],
      [Page #counter(page).display() / #counter(page).final().first()],
    )
  ],
)

#set text(font: ("DejaVu Sans", "Liberation Sans"), size: 9pt, fill: rgb("#14161a"))
#set par(justify: false, leading: 0.62em)

#let sect(titre, corps) = block(width: 100%, breakable: true)[
  #v(6pt)
  #block(width: 100%, fill: accent-clair, inset: (x: 7pt, y: 5pt), radius: 2pt)[
    #text(size: 11pt, weight: "bold", fill: accent)[#titre]
  ]
  #v(5pt)
  #corps
  #v(4pt)
]

#let chiffre(libelle, valeur) = block(
  width: 100%,
  inset: 6pt,
  radius: 2pt,
  stroke: 0.5pt + trait,
  [
    #text(size: 8pt, fill: gris)[#libelle]
    #linebreak()
    #text(size: 14pt, weight: "bold", fill: accent)[#valeur]
  ],
)

// ─── En-tête ────────────────────────────────────────────────────────────────────
#grid(
  columns: (auto, 1fr),
  column-gutter: 10pt,
  align: (left, left + horizon),
  image("teliman-logistique-logo.jpg", width: 30mm),
  [
    #text(size: 16pt, weight: "bold")[Rapport bus]
    #linebreak()
    #text(size: 11pt, weight: "bold", fill: accent)[Immatriculation #data.at("plate", default: "")]
    #linebreak()
    #v(2pt)
    #text(size: 10pt, fill: gris)[Activité, vitesses, kilométrage, alertes et entretien]
    #linebreak()
    #text(size: 12pt, weight: "bold", fill: accent)[#data.at("date", default: "")]
  ],
)
#v(3pt)
#line(length: 100%, stroke: 1pt + accent)

#let activite = data.at("activity", default: (:))

// ─── 1. Activité du jour ────────────────────────────────────────────────────────
#sect("1. Activité du jour")[
  #grid(
    columns: (1fr,) * 5,
    column-gutter: 5pt,
    chiffre("Début", activite.at("start", default: "—")),
    chiffre("Fin", activite.at("end", default: "—")),
    chiffre("Durée", activite.at("amplitude", default: "—")),
    chiffre("Km parcourus", activite.at("distance", default: "—")),
    chiffre("Vitesses moy. / max", activite.at("speeds", default: "—")),
  )
  #v(4pt)
  #text(size: 8pt, fill: gris)[Kilométrage en km, vitesses en km/h — données issues du suivi GPS du véhicule.]
]

// ─── 2. Trajets enregistrés ─────────────────────────────────────────────────────
#sect("2. Trajets enregistrés")[
  #let trajets = data.at("itinerary", default: ())
  #if trajets.len() == 0 [
    Aucun passage de zone enregistré sur la journée.
  ] else [
    #table(
      columns: (auto, 1fr),
      inset: 5pt,
      stroke: (x, y) => (bottom: 0.3pt + trait, rest: none),
      table.header([*Heure*], [*Lieu traversé*]),
      ..trajets.map(step => (
        [#step.at("time", default: "—")],
        [#step.at("zone", default: "")],
      )).flatten(),
    )
  ]
  #v(4pt)
  #let manquants = data.at("missingStops", default: ())
  #if manquants.len() > 0 [
    #text(size: 8.5pt, fill: alerte)[Étapes non enregistrées ce jour : #manquants.join(", ")]
    #linebreak()
  ]
  #text(size: 8pt, fill: gris)[Trajet habituel : #data.at("usualRoute", default: "")]
]

// ─── 3. Alertes ─────────────────────────────────────────────────────────────────
#sect("3. Alertes")[
  #let alertes = data.at("alerts", default: (:))
  #let exces = alertes.at("speedBreaches", default: ())
  #let signales = alertes.at("speedAlerts", default: ())
  #let accidents = alertes.at("crashAlerts", default: ())
  #grid(
    columns: (1fr, 1fr),
    column-gutter: 8pt,
    [
      #text(weight: "bold")[Excès de vitesse]
      #linebreak()
      #if exces.len() > 0 [
        #text(size: 9pt)[#str(exces.len()) relevé(s) au-dessus de #str(alertes.at("speedLimitKmh", default: 90)) km/h]
        #for breach in exces.slice(0, calc.min(5, exces.len())) [
          #linebreak()
          #text(size: 8.5pt, fill: gris)[— #breach.at("time", default: "") : #str(breach.at("speed", default: 0)) km/h]
        ]
      ] else if signales.len() > 0 [
        #text(size: 9pt)[#str(signales.len()) signalé(s) par le suivi]
      ] else [
        #text(size: 9pt, fill: gris)[Aucun excès relevé]
      ]
    ],
    [
      #text(weight: "bold")[Accident]
      #linebreak()
      #if accidents.len() > 0 [
        #text(size: 9pt, fill: alerte)[#str(accidents.len()) signalement(s) — vérifier l'état du véhicule]
      ] else [
        #text(size: 9pt, fill: gris)[Aucun signalement]
      ]
    ],
  )
]

// ─── 4. Entretien ───────────────────────────────────────────────────────────────
#sect("4. Entretien — vidange")[
  #let entretien = data.at("maintenance", default: (:))
  #let niveau = entretien.at("level", default: "unknown")
  #let couleur = if niveau == "overdue" or niveau == "due" { alerte } else if niveau == "warn" { rgb("#8a6d12") } else { gris }
  #text(size: 10pt, fill: couleur)[#entretien.at("text", default: "Référence de vidange non renseignée.")]
  #v(3pt)
  #text(size: 8pt, fill: gris)[Vidange à 5000 km — alerte de programmation à 4000 km. Référence issue du registre des vidanges de la plateforme.]
]
