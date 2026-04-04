export function printDeliveryOrder(order) {
  const html = `
    <html>
      <head>
        <title>Bon de livraison ${order.reference}</title>
        <style>
          body { font-family: Inter, Arial, sans-serif; padding: 32px; color: #0f172a; }
          h1 { margin-bottom: 6px; }
          .muted { color: #64748b; margin-bottom: 24px; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
          .card { border: 1px solid #cbd5e1; border-radius: 12px; padding: 16px; }
          .card span { display: block; font-size: 12px; color: #64748b; }
          .card strong { display: block; margin-top: 6px; font-size: 18px; }
          .block { margin-bottom: 24px; }
          .label { font-size: 12px; color: #64748b; margin-bottom: 6px; }
          .value { font-size: 16px; }
        </style>
      </head>
      <body>
        <h1>Bon de livraison ${order.reference}</h1>
        <div class="muted">${order.truckLabel} — ${order.driver}</div>
        <div class="grid">
          <div class="card"><span>Client</span><strong>${order.client || '-'}</strong></div>
          <div class="card"><span>Destination</span><strong>${order.destination || '-'}</strong></div>
          <div class="card"><span>Marchandise</span><strong>${order.goods || '-'}</strong></div>
          <div class="card"><span>Quantité</span><strong>${order.quantity || '-'}</strong></div>
          <div class="card"><span>Statut</span><strong>${order.active ? 'Actif' : order.status || '-'}</strong></div>
          <div class="card"><span>Date mission</span><strong>${order.date ? new Date(order.date).toLocaleString() : '-'}</strong></div>
        </div>
        <div class="block"><div class="label">Point de chargement</div><div class="value">${order.loadingPoint || '-'}</div></div>
        <div class="block"><div class="label">Notes</div><div class="value">${order.notes || '-'}</div></div>
      </body>
    </html>
  `

  const printWindow = window.open('', '_blank', 'width=900,height=700')
  if (!printWindow) return
  printWindow.document.write(html)
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
}
