import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb)
const KEY_LENGTH = 64

/**
 * scrypt password hashing via Node's builtin crypto — deliberately avoids
 * bcrypt/argon2 native modules, which are a recurring source of Windows
 * build-toolchain pain on this machine's other projects.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer
  return `scrypt:${salt.toString('hex')}:${derivedKey.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split(':')
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false
  const salt = Buffer.from(saltHex, 'hex')
  const expectedKey = Buffer.from(keyHex, 'hex')
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH)) as Buffer
  if (derivedKey.length !== expectedKey.length) return false
  return timingSafeEqual(derivedKey, expectedKey)
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}
