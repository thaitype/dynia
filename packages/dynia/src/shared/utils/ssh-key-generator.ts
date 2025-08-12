import { writeFile, readFile, access, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { spawn } from 'child_process';
import type { ILogger } from '@thaitype/core-utils';

export interface SSHKeyPair {
  privateKey: string;
  publicKey: string;
  fingerprint: string;
}

export interface SSHKeyGeneratorOptions {
  keyName?: string;
  keyType?: 'rsa' | 'ed25519' | 'ecdsa';
  keySize?: number;
  comment?: string;
}

/**
 * SSH key generation and management utilities
 */
export class SSHKeyGenerator {
  constructor(private readonly logger: ILogger) {}

  /**
   * Check if ssh-keygen is available on the system
   */
  async validateSSHKeygenAvailable(): Promise<void> {
    try {
      // Try to execute ssh-keygen with help flag to verify it exists
      await this.executeCommand('ssh-keygen --help 2>&1 | head -1 || ssh-keygen 2>&1 | head -1');
    } catch (error) {
      throw new Error(
        'ssh-keygen is not available on this system. ' +
        'Please install OpenSSH client tools to generate SSH keys.'
      );
    }
  }

  /**
   * Generate a new SSH key pair using ssh-keygen
   */
  async generateKeyPair(options: SSHKeyGeneratorOptions = {}): Promise<SSHKeyPair> {
    const {
      keyName = 'dynia',
      keyType = 'rsa',
      keySize = 4096,
      comment = 'dynia-generated-key'
    } = options;

    this.logger.info(`Generating SSH key pair: ${keyName} (${keyType} ${keySize})`);

    try {
      const keyPaths = this.getKeyPaths(keyName);
      
      // Ensure .ssh directory exists
      await mkdir(dirname(keyPaths.privateKeyPath), { recursive: true });

      // Generate key pair using ssh-keygen
      const sshKeygenCmd = `ssh-keygen -t ${keyType} -b ${keySize} -C "${comment}" -f "${keyPaths.privateKeyPath}" -N ""`;
      await this.executeCommand(sshKeygenCmd);

      // Read the generated files
      const privateKey = await readFile(keyPaths.privateKeyPath, 'utf-8');
      const publicKey = await readFile(keyPaths.publicKeyPath, 'utf-8');

      // Get fingerprint using ssh-keygen
      const fingerprintOutput = await this.executeCommand(`ssh-keygen -lf "${keyPaths.publicKeyPath}"`);
      const fingerprint = this.parseFingerprint(fingerprintOutput);

      this.logger.info(`✅ SSH key generated: ${keyName}`);
      
      return {
        privateKey,
        publicKey: publicKey.trim(),
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
   * Execute a command and return its output
   */
  private async executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn('sh', ['-c', command], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      process.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      process.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Command failed (exit code ${code}): ${stderr.trim() || stdout.trim()}`));
        }
      });

      process.on('error', (error) => {
        reject(new Error(`Command execution error: ${error.message}`));
      });
    });
  }

  /**
   * Parse fingerprint from ssh-keygen output
   */
  private parseFingerprint(sshKeygenOutput: string): string {
    // ssh-keygen output format: "4096 SHA256:... user@host (RSA)" or "4096 MD5:aa:bb:cc:... user@host (RSA)"
    // DigitalOcean expects MD5 format, so try to get MD5 or convert SHA256
    const md5Match = sshKeygenOutput.match(/MD5:([a-f0-9:]+)/i);
    if (md5Match) {
      return md5Match[1];
    }

    // If SHA256, we need to get MD5 format specifically
    try {
      // Extract just the fingerprint part for DigitalOcean
      const fingerprintMatch = sshKeygenOutput.match(/(\d+)\s+(SHA256:[^\s]+|MD5:[a-f0-9:]+)/);
      if (fingerprintMatch) {
        return fingerprintMatch[2];
      }
    } catch (error) {
      this.logger.debug(`Could not parse fingerprint: ${error}`);
    }

    // Fallback: return the whole line minus leading/trailing whitespace
    return sshKeygenOutput.trim();
  }

  /**
   * Generate fingerprint from existing private key
   */
  private async generateFingerprintFromPrivateKey(privateKey: string): Promise<string> {
    try {
      // Create a temporary file for the private key
      const tempKeyPath = join(homedir(), '.ssh', 'temp_dynia_key');
      await writeFile(tempKeyPath, privateKey, { mode: 0o600 });
      
      try {
        // Use ssh-keygen to get fingerprint from private key
        const fingerprintOutput = await this.executeCommand(`ssh-keygen -lf "${tempKeyPath}"`);
        return this.parseFingerprint(fingerprintOutput);
      } finally {
        // Clean up temporary file
        try {
          await access(tempKeyPath);
          await this.executeCommand(`rm "${tempKeyPath}"`);
        } catch {
          // Ignore cleanup errors
        }
      }
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