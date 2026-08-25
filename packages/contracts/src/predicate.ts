import { z } from 'zod'

/**
 * A Predicate names *what kind of assertion* a claim is making about its
 * subject entity. This is the vocabulary the whole platform speaks — every
 * connector emits claims tagged with one of these, every dossier tab is a
 * filtered view over a subset of them, and adding a new fact type means
 * adding a predicate here, not a database column.
 */
export const Predicate = z.enum([
  // identity
  'full_name',
  'first_name',
  'middle_name',
  'last_name',
  'alias',
  'date_of_birth',
  'date_of_birth_year', // partial precision, common on public sources
  'date_of_death',
  'age',
  'gender',
  'ssn_last4',
  'photo',

  // contact / location
  'current_address',
  'former_address',
  'mailing_address',
  'phone_number',
  'phone_line_type', // mobile/landline/voip
  'phone_carrier',
  'email_address',
  'ip_address_seen',

  // relationships
  'relative_of',
  'spouse_of',
  'associate_of',
  'coworker_of',
  'neighbor_of',
  'employee_of',
  'owner_of',
  'officer_of',
  'registered_agent_of',

  // vital records
  'marriage_record',
  'divorce_record',
  'death_record',
  'obituary',

  // courts & corrections
  'court_case',
  'criminal_charge',
  'case_disposition',
  'incarceration_record',
  'sex_offender_registration',
  'protective_order',
  'bankruptcy_filing',
  'civil_judgment',
  'lien',

  // property & assets
  'property_ownership',
  'property_assessment',
  'vehicle_registration',
  'vessel_registration',
  'aircraft_registration',
  'ucc_filing',

  // business & professional
  'business_registration',
  'business_officer',
  'professional_license',
  'sec_filing',
  'finra_disclosure',
  'campaign_contribution',
  'government_contract',
  'nonprofit_filing',

  // sanctions & watchlists
  'sanctions_listing',
  'pep_status',
  'wanted_listing',
  'exclusion_listing',

  // digital footprint
  'username_presence',
  'social_profile',
  'domain_registration',
  'domain_certificate',
  'breach_exposure',
  'paste_exposure',
  'device_fingerprint',
  'geolocation',

  // media & documents
  'image_exif',
  'image_face_embedding',
  'document_text',
  'reverse_image_match',
])
export type Predicate = z.infer<typeof Predicate>

/** Groupings used purely for UI tab routing — a predicate can appear in exactly one. */
export const PREDICATE_CATEGORY: Record<Predicate, string> = {
  full_name: 'identity', first_name: 'identity', middle_name: 'identity', last_name: 'identity',
  alias: 'identity', date_of_birth: 'identity', date_of_birth_year: 'identity',
  date_of_death: 'identity', age: 'identity', gender: 'identity', ssn_last4: 'identity', photo: 'identity',

  current_address: 'addresses', former_address: 'addresses', mailing_address: 'addresses',
  phone_number: 'contact', phone_line_type: 'contact', phone_carrier: 'contact',
  email_address: 'contact', ip_address_seen: 'contact',

  relative_of: 'relationships', spouse_of: 'relationships', associate_of: 'relationships',
  coworker_of: 'relationships', neighbor_of: 'relationships', employee_of: 'relationships',
  owner_of: 'relationships', officer_of: 'relationships', registered_agent_of: 'relationships',

  marriage_record: 'vital_records', divorce_record: 'vital_records',
  death_record: 'vital_records', obituary: 'vital_records',

  court_case: 'criminal_legal', criminal_charge: 'criminal_legal', case_disposition: 'criminal_legal',
  incarceration_record: 'criminal_legal', sex_offender_registration: 'criminal_legal',
  protective_order: 'criminal_legal', bankruptcy_filing: 'criminal_legal',
  civil_judgment: 'criminal_legal', lien: 'criminal_legal',

  property_ownership: 'property_assets', property_assessment: 'property_assets',
  vehicle_registration: 'vehicles', vessel_registration: 'vehicles', aircraft_registration: 'vehicles',
  ucc_filing: 'property_assets',

  business_registration: 'business', business_officer: 'business', professional_license: 'business',
  sec_filing: 'financial', finra_disclosure: 'financial', campaign_contribution: 'financial',
  government_contract: 'financial', nonprofit_filing: 'financial',

  sanctions_listing: 'watchlists', pep_status: 'watchlists',
  wanted_listing: 'watchlists', exclusion_listing: 'watchlists',

  username_presence: 'digital', social_profile: 'digital', domain_registration: 'digital',
  domain_certificate: 'digital', breach_exposure: 'digital', paste_exposure: 'digital',
  device_fingerprint: 'digital', geolocation: 'digital',

  image_exif: 'media', image_face_embedding: 'media', document_text: 'media', reverse_image_match: 'media',
}
