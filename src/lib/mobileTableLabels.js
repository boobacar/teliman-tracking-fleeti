// Libellés des cartes mobiles.
//
// Sur téléphone, les tableaux de liste (bons, alertes, utilisateurs, vidanges…)
// sont affichés en pile de cartes : chaque cellule a besoin du nom de sa colonne.
// Plutôt que de recopier ces libellés dans onze pages, on les lit dans l'en-tête du
// tableau et on les écrit dans l'attribut data-label, que le CSS affiche via ::before.
//
// L'observateur suit les changements de route et les rafraîchissements de données :
// dès qu'un tableau réapparaît, ses cellules sont ré-annotées.

const TABLE_SELECTOR = 'table.mobile-cards'

export function labelTableCells(root) {
  const scope = root && typeof root.querySelectorAll === 'function' ? root : document
  let annotated = 0
  for (const table of scope.querySelectorAll(TABLE_SELECTOR)) {
    const headers = [...table.querySelectorAll('thead th')].map((cell) => cell.textContent.trim())
    if (!headers.length) continue
    for (const row of table.querySelectorAll('tbody tr')) {
      const cells = [...row.querySelectorAll('td')]
      cells.forEach((cell, index) => {
        const label = headers[index]
        if (label && cell.getAttribute('data-label') !== label) {
          cell.setAttribute('data-label', label)
          annotated += 1
        }
      })
    }
  }
  return annotated
}

let observer = null
let scheduled = false

function schedule() {
  if (scheduled) return
  scheduled = true
  // setTimeout et non requestAnimationFrame : rAF est suspendu dans un onglet en
  // arrière-plan (et lors du chargement d'un onglet non visible), ce qui laisserait
  // les cartes sans libellés.
  setTimeout(() => {
    scheduled = false
    labelTableCells(document)
  }, 0)
}

// Démarre l'annotation continue. Retourne une fonction d'arrêt (utile aux tests).
export function startMobileTableLabels() {
  labelTableCells(document)
  if (typeof MutationObserver !== 'function' || !document.body) return () => {}
  observer = new MutationObserver(() => {
    // Annotation immédiate (le coût est de l'ordre de quelques centaines de
    // cellules) — puis plus rien tant que le DOM ne bouge pas.
    labelTableCells(document)
    schedule()
  })
  // On n'observe que l'ajout/retrait de nœuds : nos écritures d'attributs ne
  // redéclenchent donc jamais l'observateur (pas de boucle).
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer?.disconnect()
    observer = null
  }
}
