import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer | null {
  const raw = process.env.REVERIE_SECRETS_KEY ?? process.env.NEXT_SERVER_SECRETS_KEY;
  if (!raw) return null;
  return crypto.createHash('sha256').update(raw).digest();
}

export function canEncryptSecrets(): boolean {
  return Boolean(getKey());
}

export function encryptSecret(value: string): string {
  const key = getKey();
  if (!key) throw new Error('Secret encryption key is not configured.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptSecret(value: string): string {
  const key = getKey();
  if (!key) throw new Error('Secret encryption key is not configured.');
  const [ivRaw, tagRaw, encryptedRaw] = value.split('.');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
