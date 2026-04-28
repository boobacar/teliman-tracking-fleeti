export const fallbackEvents = [
  { tracker_id: 3488326, label: '45792WWCI01', chauffeur: 'YAKOUBA DIOMANDE', time: '2026-04-02T19:42:53Z', event: 'speedup', message: 'Excès de vitesse - 91 km/h', address: 'Mankono, Côte d’Ivoire' },
  { tracker_id: 3488326, label: '45792WWCI01', chauffeur: 'YAKOUBA DIOMANDE', time: '2026-04-02T15:40:03Z', event: 'speedup', message: 'Excès de vitesse - 96 km/h', address: 'Séguéla - Boundiali, Côte d’Ivoire' },
  { tracker_id: 3487533, label: '3952WWCI01', chauffeur: 'BAMA TRAORE', time: '2026-04-02T15:58:58Z', event: 'excessive_parking', message: 'Stationnement excessif', address: 'Séguéla - Boundiali, Côte d’Ivoire' },
  { tracker_id: 3537761, label: '3100WWCI01', chauffeur: 'SRIKI', time: '2026-04-02T15:56:07Z', event: 'excessive_parking', message: 'Stationnement excessif', address: 'Kossihouen, Côte d’Ivoire' },
]

export const trackerMileageFallback = {
  3487533: { '2026-04-01': { mileage: 619.68 }, '2026-04-02': { mileage: 432.62 } },
  3487539: { '2026-04-01': { mileage: 618.46 }, '2026-04-02': { mileage: 435.17 } },
  3488325: { '2026-04-01': { mileage: 596.38 }, '2026-04-02': { mileage: 463.26 } },
  3488326: { '2026-04-01': { mileage: 633.16 }, '2026-04-02': { mileage: 546.79 } },
  3511635: { '2026-04-01': { mileage: 149.6 }, '2026-04-02': { mileage: 189.47 } },
  3537761: { '2026-04-01': { mileage: 74.03 }, '2026-04-02': { mileage: 195.14 } },
  3537762: { '2026-04-01': { mileage: 601.75 }, '2026-04-02': { mileage: 462.25 } },
  3537766: { '2026-04-01': { mileage: 58.8 }, '2026-04-02': null },
}

export const employeeFallback = [
  { id: 259454, tracker_id: 3580652, first_name: 'MAKO', last_name: 'DOSSO', phone: '0709584823' },
  { id: 259458, tracker_id: 3488326, first_name: 'YAKOUBA', last_name: 'DIOMANDE', phone: '' },
  { id: 259464, tracker_id: 3488325, first_name: 'ADAMA', last_name: 'CAMARA', phone: '0759171776' },
  { id: 259466, tracker_id: 3487539, first_name: 'SARIA', last_name: 'YACOUBA', phone: '0171848451' },
  { id: 259467, tracker_id: 3487533, first_name: 'BAMA', last_name: 'TRAORE', phone: '0707959882' },
  { id: 263177, tracker_id: 3537762, first_name: 'BAMBA', last_name: 'LAMA', phone: '' },
  { id: 263178, tracker_id: 3537766, first_name: 'DAOUDA', last_name: 'DANIOKO', phone: '' },
  { id: 263179, tracker_id: 3537761, first_name: 'SRIKI', last_name: '', phone: '' },
]
