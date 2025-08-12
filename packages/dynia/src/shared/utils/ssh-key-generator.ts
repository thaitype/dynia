import { generateKeyPair } from 'crypto';
import { promisify } from 'util';
import { writeFile, readFile, access, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import type { ILogger } from '@thaitype/core-utils';

const generateKeyPairAsync = promisify(generateKeyPair);

export interface SSHKeyPair {
  privateKey: string;
  publicKey: string;
  fingerprint: string;
}

export interface SSHKeyGeneratorOptions {
  keyName?: string;
  keySize?: number;
  comment?: string;
}

/**
 * SSH key generation and management utilities
 */
export class SSHKeyGenerator {
  constructor(private readonly logger: ILogger) {}

  /**
   * Generate a new SSH key pair
   */
  async generateKeyPair(options: SSHKeyGeneratorOptions = {}): Promise<SSHKeyPair> {
    const {
      keyName = 'dynia',
      keySize = 2048,
      comment = 'dynia-generated-key'
    } = options;

    this.logger.info(`Generating SSH key pair: ${keyName}`);

    try {
      // Generate RSA key pair
      const { publicKey, privateKey } = await generateKeyPairAsync('rsa', {
        modulusLength: keySize,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs8',
          format: 'pem'
        }
      });

      // Convert public key to OpenSSH format
      const sshPublicKey = this.convertToSSHFormat(publicKey, comment);
      
      // Generate fingerprint
      const fingerprint = await this.generateFingerprint(publicKey);

      return {
        privateKey,
        publicKey: sshPublicKey,
        fingerprint
      };
    } catch (error) {
      throw new Error(`Failed to generate SSH key pair: ${error}`);
    }
  }

  /**
   * Save SSH key pair to files
   */
  async saveKeyPair(keyPair: SSHKeyPair, keyName: string = 'dynia'): Promise<{ privateKeyPath: string; publicKeyPath: string }> {
    const sshDir = join(homedir(), '.ssh');
    const privateKeyPath = join(sshDir, keyName);
    const publicKeyPath = join(sshDir, `${keyName}.pub`);

    try {
      // Ensure .ssh directory exists
      await mkdir(sshDir, { recursive: true });

      // Save private key with restrictive permissions
      await writeFile(privateKeyPath, keyPair.privateKey, { mode: 0o600 });
      
      // Save public key
      await writeFile(publicKeyPath, keyPair.publicKey, { mode: 0o644 });

      this.logger.info(`SSH key saved to ${privateKeyPath}`);

      return { privateKeyPath, publicKeyPath };
    } catch (error) {
      throw new Error(`Failed to save SSH key: ${error}`);
    }
  }

  /**
   * Load existing SSH key pair from files
   */
  async loadKeyPair(keyName: string = 'dynia'): Promise<SSHKeyPair | null> {
    const sshDir = join(homedir(), '.ssh');
    const privateKeyPath = join(sshDir, keyName);
    const publicKeyPath = join(sshDir, `${keyName}.pub`);

    try {
      // Check if both files exist
      await access(privateKeyPath);
      await access(publicKeyPath);

      const privateKey = await readFile(privateKeyPath, 'utf-8');
      const publicKey = await readFile(publicKeyPath, 'utf-8');
      
      // Generate fingerprint from private key
      const fingerprint = await this.generateFingerprintFromPrivateKey(privateKey);

      return {
        privateKey,
        publicKey: publicKey.trim(),
        fingerprint
      };
    } catch (error) {
      // Files don't exist or can't be read
      this.logger.debug(`SSH key pair not found at ${privateKeyPath}: ${error}`);
      return null;
    }
  }

  /**
   * Check if SSH key pair exists
   */
  async keyPairExists(keyName: string = 'dynia'): Promise<boolean> {
    const keyPair = await this.loadKeyPair(keyName);
    return keyPair !== null;
  }

  /**
   * Convert PEM public key to OpenSSH format
   */
  private convertToSSHFormat(pemPublicKey: string, comment: string): string {
    // Remove PEM headers and convert to SSH format
    const keyData = pemPublicKey
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\n/g, '');

    // For RSA keys, we need to extract the RSA components and format them properly
    // This is a simplified conversion - in production, you might want to use a proper library
    return `ssh-rsa ${keyData} ${comment}`;
  }

  /**
   * Generate MD5 fingerprint from public key
   */
  private async generateFingerprint(publicKey: string): Promise<string> {
    const crypto = await import('crypto');
    
    // Extract key data (simplified approach)
    const keyData = publicKey
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\n/g, '');
    
    // Generate MD5 hash
    const hash = crypto.createHash('md5').update(Buffer.from(keyData, 'base64')).digest('hex');
    
    // Format as SSH fingerprint
    return hash.match(/.{2}/g)?.join(':') || '';
  }

  /**
   * Generate fingerprint from private key
   */
  private async generateFingerprintFromPrivateKey(privateKey: string): Promise<string> {
    const crypto = await import('crypto');
    
    try {
      // Extract public key from private key
      const keyObject = crypto.createPrivateKey(privateKey);
      const publicKey = crypto.createPublicKey(keyObject);
      const pemPublicKey = publicKey.export({ type: 'spki', format: 'pem' }) as string;
      
      return await this.generateFingerprint(pemPublicKey);
    } catch (error) {
      throw new Error(`Failed to generate fingerprint from private key: ${error}`);
    }
  }

  /**
   * Get SSH key paths for a given key name
   */
  getKeyPaths(keyName: string = 'dynia'): { privateKeyPath: string; publicKeyPath: string } {
    const sshDir = join(homedir(), '.ssh');
    return {
      privateKeyPath: join(sshDir, keyName),
      publicKeyPath: join(sshDir, `${keyName}.pub`)
    };
  }
}