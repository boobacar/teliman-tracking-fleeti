import { z } from 'zod'

// ── Delivery Order ──
export const deliveryOrderSchema = z.object({
  reference: z.string().trim().optional().default(''),
  trackerId: z.union([z.string().trim(), z.number()]).transform((v) => String(v)).pipe(z.string().min(1, 'Camion requis')),
  truckLabel: z.string().trim().min(1, 'Label camion requis'),
  driver: z.string().trim().optional().default(''),
  client: z.string().trim().optional().default(''),
  loadingPoint: z.string().trim().optional().default(''),
  destination: z.string().trim().optional().default(''),
  goods: z.string().trim().optional().default(''),
  quantity: z.string().trim().optional().default(''),
  status: z.string().trim().optional().default(''),
  active: z.boolean().optional().default(true),
  date: z.string().trim().optional().default(''),
  departureDateTime: z.string().trim().optional().default(''),
  arrivalDateTime: z.string().trim().optional().default(''),
  notes: z.string().trim().optional().default(''),
  completedAt: z.string().trim().nullable().optional().default(null),
  proofPhotoDataUrl: z.string().optional().default(''),
  proofPhotoDataUrls: z.array(z.string()).optional().default([]),
})

export const deliveryOrderUpdateSchema = deliveryOrderSchema.partial()

// ── Fuel Voucher ──
export const fuelVoucherSchema = z.object({
  voucherNumber: z.string().trim().min(1, 'Numéro de bon requis'),
  trackerId: z.union([z.string().trim(), z.number()]).transform((v) => String(v)).pipe(z.string().min(1, 'Camion requis')),
  truckLabel: z.string().trim().min(1, 'Label camion requis'),
  driver: z.string().trim().optional().default(''),
  supplier: z.string().trim().optional().default(''),
  dateTime: z.string().trim().min(1, 'Date requise'),
  quantityLiters: z.union([z.string(), z.number()]).transform((v) => Number(v)).pipe(z.number().min(0, 'Quantité ≥ 0')),
  unitPrice: z.union([z.string(), z.number()]).transform((v) => Number(v)).pipe(z.number().min(0, 'Prix ≥ 0')),
  amount: z.union([z.string(), z.number()]).transform((v) => Number(v)).pipe(z.number().optional().default(0)),
  proofPhotoDataUrl: z.string().optional().default(''),
  proofPhotoDataUrls: z.array(z.string()).optional().default([]),
  notes: z.string().trim().optional().default(''),
})

export const fuelVoucherUpdateSchema = fuelVoucherSchema.partial()

// ── Oil Change ──
export const oilChangeSchema = z.object({
  trackerId: z.union([z.string().trim(), z.number()]).transform((v) => String(v)).pipe(z.string().min(1, 'Camion requis')),
  truckLabel: z.string().trim().min(1, 'Label camion requis'),
  date: z.string().trim().min(1, 'Date requise'),
  odometerKm: z.union([z.string(), z.number()]).transform((v) => Number(v)).pipe(z.number().min(0, 'Kilométrage ≥ 0')),
  oilType: z.string().trim().optional().default(''),
  oilQuantityL: z.union([z.string(), z.number()]).transform((v) => Number(v)).pipe(z.number().min(0, 'Quantité ≥ 0')),
  filterChanged: z.boolean().optional().default(true),
  nextChangeKm: z.union([z.string(), z.number()]).transform((v) => Number(v)).pipe(z.number().optional().default(0)),
  nextChangeDate: z.string().trim().optional().default(''),
  notes: z.string().trim().optional().default(''),
  receiptExpiryDate: z.string().trim().optional().default(''),
})

export const oilChangeUpdateSchema = oilChangeSchema.partial()

// ── Admin User ──
export const adminUserSchema = z.object({
  email: z.string().trim().email('Email invalide').toLowerCase(),
  role: z.enum(['admin', 'ops', 'user']).optional().default('user'),
  password: z.string().min(6, 'Mot de passe ≥ 6 caractères'),
  permissions: z.array(z.string().trim()).optional().default([]),
})

export const adminUserUpdateSchema = z.object({
  email: z.string().trim().email('Email invalide').toLowerCase().optional(),
  role: z.enum(['admin', 'ops', 'user']).optional(),
  password: z.string().min(6, 'Mot de passe ≥ 6 caractères').optional(),
  permissions: z.array(z.string().trim()).optional(),
})

// ── Helper ──
export function validateBody(schema, body) {
  const result = schema.safeParse(body)
  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Validation: ${errors}`)
  }
  return result.data
}
