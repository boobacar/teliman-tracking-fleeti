import { z } from 'zod'

// ── Delivery Order ──
// NOTE: aucun .default() pour éviter que Zod remplisse les champs absents
// lors des PATCH partiels. Les valeurs par défaut sont gérées par sanitizeDeliveryOrderPayload.
export const deliveryOrderSchema = z.object({
  reference: z.string().trim().optional(),
  trackerId: z.union([z.string().trim(), z.number()]).transform((v) => String(v)).pipe(z.string().min(1, 'Camion requis')),
  truckLabel: z.string().trim().min(1, 'Label camion requis'),
  driver: z.string().trim().optional(),
  client: z.string().trim().optional(),
  loadingPoint: z.string().trim().optional(),
  destination: z.string().trim().optional(),
  goods: z.string().trim().optional(),
  quantity: z.string().trim().optional(),
  status: z.string().trim().optional(),
  active: z.boolean().optional(),
  date: z.string().trim().optional(),
  departureDateTime: z.string().trim().optional(),
  arrivalDateTime: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  completedAt: z.string().trim().nullable().optional(),
  proofPhotoDataUrl: z.string().optional(),
  proofPhotoDataUrls: z.array(z.string()).optional(),
})

export const deliveryOrderUpdateSchema = deliveryOrderSchema.partial()

// ── Fuel Voucher ──
export const fuelVoucherSchema = z.object({
  voucherNumber: z.string().trim().min(1, 'Numéro de bon requis'),
  trackerId: z.union([z.string().trim(), z.number()]).transform((v) => String(v)).pipe(z.string().min(1, 'Camion requis')),
  truckLabel: z.string().trim().min(1, 'Label camion requis'),
  driver: z.string().trim().optional(),
  supplier: z.string().trim().optional(),
  dateTime: z.string().trim().min(1, 'Date requise'),
  quantityLiters: z.union([z.string(), z.number()]).transform((v) => Number(v)).pipe(z.number().min(0, 'Quantité ≥ 0')),
  unitPrice: z.union([z.string(), z.number()]).transform((v) => Number(v)).pipe(z.number().min(0, 'Prix ≥ 0')),
  amount: z.union([z.string(), z.number()]).transform((v) => Number(v)).pipe(z.number().optional()),
  proofPhotoDataUrl: z.string().optional(),
  proofPhotoDataUrls: z.array(z.string()).optional(),
  notes: z.string().trim().optional(),
  client: z.string().trim().optional(),
})

export const fuelVoucherUpdateSchema = fuelVoucherSchema.partial()

// ── Oil Change ──
export const oilChangeSchema = z.object({
  trackerId: z.union([z.string().trim(), z.number()]).transform((v) => String(v)).pipe(z.string().min(1, 'Camion requis')),
  truckLabel: z.string().trim().min(1, 'Label camion requis'),
  date: z.string().trim().min(1, 'Date requise'),
  odometerKm: z.union([z.string(), z.number()]).transform((v) => Number(v)).pipe(z.number().min(0, 'Kilométrage ≥ 0')),
  oilType: z.string().trim().optional(),
  oilQuantityL: z.union([z.string(), z.number()]).transform((v) => Number(v)).pipe(z.number().min(0, 'Quantité ≥ 0')),
  filterChanged: z.boolean().optional(),
  nextChangeKm: z.union([z.string(), z.number()]).transform((v) => Number(v)).pipe(z.number().optional()),
  nextChangeDate: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  receiptExpiryDate: z.string().trim().optional(),
})

// ── Admin User ──
export const adminUserSchema = z.object({
  email: z.string().trim().email('Email invalide'),
  role: z.string().trim().min(1, 'Rôle requis'),
  permissions: z.array(z.string().trim()).optional(),
  password: z.string().trim().optional(),
})

export const adminUserUpdateSchema = adminUserSchema.partial()

// ── Helper ──
export function validateBody(schema, body) {
  const result = schema.safeParse(body)
  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Validation: ${errors}`)
  }
  return result.data
}
