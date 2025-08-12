import { BaseCommand } from '../../shared/base/base-command.js';
import { createDigitalOceanProvider } from '../../core/providers/digitalocean-provider.js';

/**
 * Options for SSH list command
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SSHListOptions {
  // No additional options for now
}

/**
 * Command to list SSH keys in DigitalOcean account
 */
export class SSHListCommand extends BaseCommand<SSHListOptions> {
  protected async run(): Promise<void> {
    this.logger.info('Listing SSH keys from DigitalOcean...');

    if (this.dryRun) {
      this.logDryRun('list SSH keys from DigitalOcean account');
      return;
    }

    const doProvider = createDigitalOceanProvider(
      this.config.secrets.digitalOceanToken,
      this.logger
    );

    const sshKeys = await doProvider.listSSHKeys();

    if (sshKeys.length === 0) {
      this.logger.info('No SSH keys found in DigitalOcean account.');
      this.logger.info('Use "dynia ssh create" to create and upload a new SSH key.');
      return;
    }

    this.logger.info(`Found ${sshKeys.length} SSH key(s):`);
    this.logger.info('');

    // Display SSH keys in a table-like format
    sshKeys.forEach((key, index) => {
      this.logger.info(`${index + 1}. ${key.name}`);
      this.logger.info(`   ID: ${key.id}`);
      this.logger.info(`   Fingerprint: ${key.fingerprint}`);
      this.logger.info(`   Public Key: ${this.truncatePublicKey(key.publicKey)}`);
      if (index < sshKeys.length - 1) {
        this.logger.info('');
      }
    });

    // Show current configured key if set
    const configuredKeyId = this.config.secrets.sshKeyId;
    if (configuredKeyId) {
      this.logger.info('');
      this.logger.info(`Current DYNIA_SSH_KEY_ID: ${configuredKeyId}`);
      
      const currentKey = sshKeys.find(key => key.id === configuredKeyId || key.fingerprint === configuredKeyId);
      if (currentKey) {
        this.logger.info(`✅ Configured key found: ${currentKey.name}`);
      } else {
        this.logger.info('⚠️  Configured key not found in account');
      }
    } else {
      this.logger.info('');
      this.logger.info('No DYNIA_SSH_KEY_ID configured. Set it in your .env file.');
    }
  }

  /**
   * Truncate public key for display
   */
  private truncatePublicKey(publicKey: string): string {
    if (publicKey.length <= 50) {
      return publicKey;
    }
    
    const parts = publicKey.split(' ');
    if (parts.length >= 2) {
      const keyType = parts[0]; // ssh-rsa, ssh-ed25519, etc.
      const keyData = parts[1];
      const comment = parts.slice(2).join(' ');
      
      if (keyData.length > 20) {
        const truncated = `${keyData.substring(0, 20)}...${keyData.slice(-10)}`;
        return `${keyType} ${truncated}${comment ? ` ${comment}` : ''}`;
      }
    }
    
    return `${publicKey.substring(0, 50)}...`;
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
    
    if (!this.config.secrets.digitalOceanToken) {
      throw new Error('DYNIA_DO_TOKEN environment variable is required to list SSH keys');
    }
  }
}