import bcrypt from 'bcryptjs';

const BCRYPT_COST = 12;

/**
 * Compared against when the email doesn't exist, so a failed login takes the
 * same time whether or not the account exists (no user enumeration by timing).
 */
const DUMMY_HASH = bcrypt.hashSync('invoicio-timing-equalizer', BCRYPT_COST);

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, hash: string | undefined): Promise<boolean> {
  return bcrypt.compare(password, hash ?? DUMMY_HASH);
}
