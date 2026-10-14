// Rapport journalier TELIMAN LOGISTIQUE — version PDF officielle (structure demandée
// par la direction : suivi général, camions actifs, camions inactifs, quantités par client).
//
// Données : fichier JSON passé en entrée
//   typst compile --root / --input data=rapport-data.json rapport-journalier.typ rapport.pdf
#let data = json(sys.inputs.data)

#let accent = rgb("#6f4525")
#let accent-clair = rgb("#f3ece5")
#let gris = rgb("#5c5f66")
#let trait = rgb("#d8d3cd")

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

// ─── En-tête ────────────────────────────────────────────────────────────────────
#grid(
  columns: (auto, 1fr),
  column-gutter: 10pt,
  align: (left, left + horizon),
  image("teliman-logistique-logo.jpg", width: 30mm),
  [
    #text(size: 16pt, weight: "bold")[Rapport journalier]
    #linebreak()
    #text(size: 10pt, fill: gris)[Suivi des camions, zones, missions et quantités]
    #linebreak()
    #v(2pt)
    #text(size: 12pt, weight: "bold", fill: accent)[#data.at("date", default: "")]
  ],
)
#v(3pt)
#line(length: 100%, stroke: 1pt + accent)

// ─── 1. Suivi général ───────────────────────────────────────────────────────────
#sect("1. Suivi général")[
  #let g = data.at("general", default: (:))
  #let chiffres = (
    ("Camions actifs", str(g.at("activeTrucks", default: 0)) + " / " + str(g.at("fleetSize", default: 0))),
    ("Missions", str(g.at("missions", default: 0))),
  )
  #let zones = g.at("zones", default: ()).map(z => ("Zone " + z.at("label", default: ""), str(z.at("count", default: 0))))
  #let cellules = chiffres + zones
  #grid(
    columns: (1fr,) * cellules.len(),
    column-gutter: 6pt,
    ..cellules.map(c => block(
      width: 100%,
      inset: 6pt,
      radius: 2pt,
      stroke: 0.5pt + trait,
      [
        #text(size: 8pt, fill: gris)[#c.at(0)]
        #linebreak()
        #text(size: 14pt, weight: "bold", fill: accent)[#c.at(1)]
      ],
    )),
  )
]

// ─── 2. Camions actifs ──────────────────────────────────────────────────────────
#sect("2. Camions actifs")[
  #let actifs = data.at("actives", default: ())
  #if actifs.len() == 0 [
    Aucun camion en activité sur la période.
  ] else [
    #for camion in actifs [
      #block(
        width: 100%,
        inset: 6pt,
        radius: 2pt,
        stroke: 0.5pt + trait,
        breakable: true,
      )[
        #grid(
          columns: (1fr, auto),
          align: (left, right),
          [
            #text(size: 11pt, weight: "bold")[#camion.at("plate", default: "")]
            #if camion.at("driver", default: "") != "" [
              #text(size: 9.5pt)[ — #camion.at("driver")]
            ] else [
              #text(size: 9pt, fill: gris)[ — chauffeur non renseigné]
            ]
          ],
          [
            #if camion.at("distanceKm", default: none) != none [
              #text(size: 9pt)[#str(camion.at("distanceKm")) km]
            ]
            #if camion.at("driving", default: "") != "" [
              #text(size: 9pt, fill: gris)[ · conduite #camion.at("driving")]
            ]
            #if camion.at("rest", default: "") != "" [
              #text(size: 9pt, fill: gris)[ · repos #camion.at("rest")]
            ]
          ],
        )
        #v(3pt)
        #let missions = camion.at("missions", default: ())
        #if missions.len() == 0 [
          #text(size: 9pt, fill: gris)[#if camion.at("zones", default: ()).len() > 0 [Pas de mission — passages de zone uniquement] else [Pas de mission enregistrée]]
        ] else [
          #table(
            columns: (auto, 1fr, auto, auto, auto),
            inset: 4pt,
            stroke: (x, y) => (bottom: 0.3pt + trait, rest: none),
            table.header([*Client*], [*Trajet*], [*Missions*], [*Départ → Livraison*], [*Qté*]),
            ..missions.map(m => (
              [#m.at("client", default: "")],
              [#m.at("route", default: "")#if m.at("goods", default: "") != "" [ (#m.at("goods"))]],
              [#str(m.at("count", default: 1))],
              [#if m.at("departure", default: "") != "" [#m.at("departure")] else [—] → #if m.at("closing", default: "") != "" [#m.at("closing")] else [—] (#m.at("status", default: ""))],
              [#m.at("quantity", default: "")],
            )).flatten(),
          )
        ]
        #v(3pt)
        #grid(
          columns: (1fr, 1fr),
          align: (left, right),
          [
            #text(size: 8.5pt, fill: gris)[Position : ]#text(size: 8.5pt)[#camion.at("position", default: "indisponible")]
            #let zones = camion.at("zones", default: ())
            #if zones.len() > 0 [
              #linebreak()
              #text(size: 8.5pt, fill: gris)[Zones : ]#text(size: 8.5pt)[#zones.map(z => z.at("text", default: z.at("zone", default: ""))).join(" · ")]
            ]
          ],
          [
            #let incidents = camion.at("incidents", default: ())
            #if incidents.len() > 0 [
              #text(size: 8.5pt, fill: rgb("#8a2b12"))[#incidents.map(i => str(i.at("count", default: 0)) + " " + i.at("label", default: "")).join(" · ")]
            ]
          ],
        )
      ]
      #v(6pt)
    ]
  ]
]

// ─── 3. Camions inactifs ────────────────────────────────────────────────────────
#sect("3. Camions inactifs")[
  #let inactifs = data.at("inactives", default: ())
  #if inactifs.len() == 0 [
    Aucun : tous les camions ont eu de l'activité.
  ] else [
    #table(
      columns: (auto, 1fr, auto),
      inset: 5pt,
      stroke: (x, y) => (bottom: 0.3pt + trait, rest: none),
      table.header([*Immatriculation*], [*Chauffeur*], [*Situation*]),
      ..inactifs.map(c => (
        [*#c.at("plate", default: "")*],
        [#c.at("driver", default: "non renseigné")],
        [#text(size: 8.5pt, fill: gris)[#c.at("reason", default: "Pas de mission")]],
      )).flatten(),
    )
  ]
]

// ─── 4. Quantités par client ────────────────────────────────────────────────────
#sect("4. Quantités livrées ou chargées par client")[
  #let quantites = data.at("quantities", default: ())
  #if quantites.len() == 0 [
    Aucune mission enregistrée sur la période.
  ] else [
    #table(
      columns: (1fr, auto, auto, auto, auto),
      inset: 5pt,
      stroke: (x, y) => (bottom: 0.3pt + trait, rest: none),
      table.header([*Client*], [*Missions*], [*Qté chargée*], [*Qté livrée*], [*Qté en cours*]),
      ..quantites.map(q => (
        [*#q.at("client", default: "")*],
        [#str(q.at("missions", default: 0))],
        [#q.at("charged", default: "—")],
        [#q.at("delivered", default: "—")],
        [#q.at("inProgress", default: "—")],
      )).flatten(),
    )
    #v(4pt)
    #text(size: 8pt, fill: gris)[Quantités additionnées telles qu'elles sont saisies dans les bons de livraison.]
  ]
]
