import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, chmodSync, readFileSync, writeFileSync, existsSync, lstatSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export class Credentials {
  constructor(keyFile) {
    const file = resolve(keyFile), directory = dirname(file);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (lstatSync(directory).isSymbolicLink()) throw new Error('Private key directory must not be a symlink');
    chmodSync(directory, 0o700);
    if (!existsSync(file)) writeFileSync(file, randomBytes(32), { flag: 'wx', mode: 0o600 });
    if (lstatSync(file).isSymbolicLink()) throw new Error('Private key must not be a symlink');
    chmodSync(file, 0o600);
    this.key = readFileSync(file);
    if (this.key.length !== 32) throw new Error('Private key must contain 32 bytes');
  }
  close() { this.key.fill(0); }
  encrypt(password, identity) {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(identity));
    const encrypted = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64');
  }
  decrypt(encrypted, identity) {
    if (encrypted === null) return undefined;
    const bytes = Buffer.from(encrypted, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(identity)); decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  }
}
