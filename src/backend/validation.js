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
  proofPhotoDataUrl: z.string().max(7_000_000).optional(),
  proofPhotoDataUrls: z.array(z.string().max(7_000_000)).max(10).optional(),
}).strict()

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
  proofPhotoDataUrl: z.string().max(7_000_000).optional(),
  proofPhotoDataUrls: z.array(z.string().max(7_000_000)).max(10).optional(),
  notes: z.string().trim().optional(),
  client: z.string().trim().optional(),
}).strict()

export const fuelVoucherUpdateSchema = fuelVoucherSchema.partial()

// ── Oil Change ──
export const oilChangeSchema = z.object({
  trackerId: z.union([z.string().trim(), z.number()]).transform((v) => String(v)).pipe(z.string().min(1, 'Camion requis').max(64)),
  truckLabel: z.string().trim().min(1, 'Label camion requis').max(160),
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide'),
  odometerKm: z.union([z.string(), z.number()]).transform((v) => Number(v)).pipe(z.number().finite().min(0).max(10_000_000)),
  oilType: z.string().trim().max(160).optional(),
  oilQuantityL: z.union([z.string(), z.number()]).transform((v) => Number(v)).pipe(z.number().finite().min(0).max(10_000)),
  filterChanged: z.boolean().optional(),
  nextChangeKm: z.union([z.string(), z.number()]).transform((v) => Number(v)).pipe(z.number().finite().min(0).max(10_000_000).optional()),
  nextChangeDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().trim().max(4000).optional(),
  receiptExpiryDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict()

export const oilChangeUpdateSchema = oilChangeSchema.partial()

// ── Admin User ──
const passwordSchema = z.string().min(12, 'Mot de passe: 12 caractères minimum').max(256)
  .regex(/[a-z]/, 'Une minuscule requise').regex(/[A-Z]/, 'Une majuscule requise')
  .regex(/[0-9]/, 'Un chiffre requis').regex(/[^A-Za-z0-9]/, 'Un caractère spécial requis')
const roleSchema = z.enum(['admin', 'user'])
const permissionsSchema = z.array(z.string().trim().min(1).max(80)).max(100)

export const adminUserSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email invalide').max(254),
  role: roleSchema,
  permissions: permissionsSchema.optional(),
  password: passwordSchema,
}).strict()

export const adminUserUpdateSchema = z.object({
  role: roleSchema.optional(),
  permissions: permissionsSchema.optional(),
  password: passwordSchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Modification requise')

const shortText = z.string().trim().max(200)
const driverOverrideSchema = z.object({
  trackerId: z.union([z.string(), z.number()]).transform(String).pipe(z.string().trim().max(64)).optional(),
  firstName: shortText.optional(), lastName: shortText.optional(), phone: z.string().trim().max(40).optional(),
  email: z.string().trim().email().max(254).optional(), isCustom: z.boolean().optional(),
}).strict()
export const driverOverridesSchema = z.object({ overrides: z.record(z.string().trim().min(1).max(100), driverOverrideSchema) }).strict()
export const driverOverrideUpdateSchema = driverOverrideSchema
export const driverAssignmentsSchema = z.object({ assignments: z.record(z.string().trim().min(1).max(100), z.union([z.string().trim().max(64), z.number(), z.null()])) }).strict()

export const whatsappTestMessageSchema = z.object({ to: z.string().trim().min(8).max(32).regex(/^\+?[0-9 ]+$/), message: z.string().trim().min(1).max(2000) }).strict()
export const whatsappReconnectSchema = z.object({ clearSession: z.boolean().optional() }).strict()
export const whatsappTemplatesSchema = z.object({ templates: z.record(z.string().max(80), z.string().trim().min(1).max(4000)) }).strict()

const boundedDateTime = z.string().trim().max(32).refine((value) => Number.isFinite(Date.parse(value)), 'Date invalide')
export const tracksQuerySchema = z.object({ trackerId: z.coerce.number().int().positive(), from: boundedDateTime.optional(), to: boundedDateTime.optional() }).strict()
export const tracksBatchSchema = z.object({
  trackerIds: z.array(z.coerce.number().int().positive()).min(1).max(50),
  period: z.enum(['1h', '6h', '12h', '24h', '48h', 'today', '7d']).optional(),
  from: boundedDateTime.optional(), to: boundedDateTime.optional(),
}).strict().refine((value) => !value.from || !value.to || Date.parse(value.to) >= Date.parse(value.from), 'Période invalide')

export const masterValueSchema = z.object({ value: z.string().trim().min(1).max(500) }).strict()

// ── Geofence ──
// NOTE: aucun .default() pour ne pas détruire les PATCH partiels (même règle que deliveryOrderUpdateSchema).
export const geofenceTypes = ['depot', 'carriere', 'chantier', 'client', 'interdite', 'autre']
export const geofenceSchema = z.object({
  name: z.string().trim().min(1, 'Nom de la zone requis').max(160),
  type: z.enum(geofenceTypes, { message: 'Type de zone invalide' }),
  lat: z.union([z.string().trim(), z.number()]).transform((v) => Number(v)).pipe(z.number().finite().min(-90).max(90, 'Latitude invalide')),
  lng: z.union([z.string().trim(), z.number()]).transform((v) => Number(v)).pipe(z.number().finite().min(-180).max(180, 'Longitude invalide')),
  radiusMeters: z.union([z.string().trim(), z.number()]).transform((v) => Number(v)).pipe(z.number().finite().min(50, 'Rayon ≥ 50 m').max(100_000, 'Rayon ≤ 100 km')),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hexadécimale invalide').optional(),
  active: z.boolean().optional(),
}).strict()

export const geofenceUpdateSchema = geofenceSchema.partial().refine((value) => Object.keys(value).length > 0, 'Modification requise')

// ── Alert Recipient ──
export const alertRecipientSchema = z.object({
  name: z.string().trim().min(1, 'Nom du destinataire requis').max(160),
  phone: z.string().trim().min(8, 'Numéro invalide').max(32).regex(/^\+?[0-9 ]+$/, 'Numéro invalide'),
  active: z.boolean().optional(),
}).strict()

export const alertRecipientUpdateSchema = alertRecipientSchema.partial().refine((value) => Object.keys(value).length > 0, 'Modification requise')

// ── Helper ──
export function validateBody(schema, body) {
  const result = schema.safeParse(body)
  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Validation: ${errors}`)
  }
  return result.data
}
