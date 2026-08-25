import { PREDICATE_CATEGORY, type Predicate } from '@osint/contracts'

export const CATEGORY_LABELS: Record<string, string> = {
  identity: 'Identity',
  addresses: 'Addresses',
  contact: 'Contact',
  relationships: 'Relationships',
  vital_records: 'Vital Records',
  criminal_legal: 'Criminal & Legal',
  property_assets: 'Property & Assets',
  vehicles: 'Vehicles',
  business: 'Business',
  financial: 'Financial',
  watchlists: 'Watchlists',
  digital: 'Digital Footprint',
  media: 'Media',
}

/** Dossier tab order — deliberately curated (not alphabetical) to mirror how an investigator reads a case top to bottom. */
export const CATEGORY_ORDER = [
  'identity', 'addresses', 'contact', 'relationships', 'criminal_legal',
  'property_assets', 'vehicles', 'business', 'financial', 'watchlists',
  'digital', 'media', 'vital_records',
]

export function predicateCategory(predicate: string): string {
  return PREDICATE_CATEGORY[predicate as Predicate] ?? 'digital'
}

export function predicateLabel(predicate: string): string {
  return predicate
    .split('_')
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')
}

export function confidenceTier(confidence: number): 'high' | 'mid' | 'low' {
  if (confidence >= 0.8) return 'high'
  if (confidence >= 0.5) return 'mid'
  return 'low'
}

export function confidenceColorVar(confidence: number): string {
  const tier = confidenceTier(confidence)
  return `var(--confidence-${tier})`
}

export const STATUS_LABELS: Record<string, string> = {
  pending: 'Queued',
  running: 'Running',
  hit: 'Hit',
  miss: 'No Match',
  blocked: 'Blocked',
  error: 'Error',
  skipped_captcha: 'CAPTCHA (Skipped)',
}
