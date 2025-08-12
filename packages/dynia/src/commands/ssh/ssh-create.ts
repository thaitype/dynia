import { BaseCommand } from '../../shared/base/base-command.js';
import { SSHKeyGenerator } from '../../shared/utils/ssh-key-generator.js';
import { createDigitalOceanProvider } from '../../core/providers/digitalocean-provider.js';

/**
 * Options for SSH create command
 */
export interface SSHCreateOptions {
  keyName?: string;
  outputEnv?: boolean;
  force?: boolean;
}

/**
 * Command to create and upload SSH keys
 */
export class SSHCreateCommand extends BaseCommand<SSHCreateOptions> {
  protected async run(): Promise<void> {
    const { keyName = 'dynia', outputEnv = false, force = false } = this.argv;

    this.logger.info(`Creating SSH key: ${keyName}`);

    const keyGenerator = new SSHKeyGenerator(this.logger);

    // Check if key already exists
    const existingKeyPair = await keyGenerator.loadKeyPair(keyName);
    if (existingKeyPair && !force) {
      this.logger.info(`SSH key pair '${keyName}' already exists. Use --force to recreate.`);
      
      // Check if it's already uploaded to DigitalOcean
      const doProvider = createDigitalOceanProvider(
        this.config.secrets.digitalOceanToken,
        this.logger
      );

      const existingDOKey = await doProvider.getSSHKey(existingKeyPair.fingerprint);
      if (existingDOKey) {
        this.logger.info(`✅ SSH key is already uploaded to DigitalOcean`);
        this.logger.info(`   Key ID: ${existingDOKey.id}`);
        this.logger.info(`   Fingerprint: ${existingDOKey.fingerprint}`);
        
        if (outputEnv) {
          this.outputEnvironmentVariable(existingDOKey.id);
        }
        return;
      } else {
        // Upload existing key
        await this.uploadExistingKey(existingKeyPair, keyName);
        return;
      }
    }

    // Generate new key pair
    const keyPair = await keyGenerator.generateKeyPair({ 
      keyName, 
      comment: `${keyName}@dynia-cli` 
    });

    // Save key pair locally
    await keyGenerator.saveKeyPair(keyPair, keyName);

    // Upload to DigitalOcean
    await this.uploadToDigitalOcean(keyPair, keyName);

    if (outputEnv) {
      // Get the uploaded key to get the ID
      const doProvider = createDigitalOceanProvider(
        this.config.secrets.digitalOceanToken,
        this.logger
      );
      const uploadedKey = await doProvider.getSSHKey(keyPair.fingerprint);
      if (uploadedKey) {
        this.outputEnvironmentVariable(uploadedKey.id);
      }
    }

    this.logger.info(`✅ SSH key '${keyName}' created and uploaded successfully`);
  }

  /**
   * Upload existing key pair to DigitalOcean
   */
  private async uploadExistingKey(keyPair: { publicKey: string; fingerprint: string }, keyName: string): Promise<void> {
    this.logger.info(`Uploading existing SSH key to DigitalOcean...`);

    if (this.dryRun) {
      this.logDryRun(`upload SSH key ${keyName} to DigitalOcean`);
      return;
    }

    const doProvider = createDigitalOceanProvider(
      this.config.secrets.digitalOceanToken,
      this.logger
    );

    try {
      const uploadedKey = await doProvider.createSSHKey({
        name: keyName,
        publicKey: keyPair.publicKey,
      });

      this.logger.info(`✅ SSH key uploaded to DigitalOcean`);
      this.logger.info(`   Key ID: ${uploadedKey.id}`);
      this.logger.info(`   Fingerprint: ${uploadedKey.fingerprint}`);
    } catch (error) {
      // Check if key already exists with different name
      const existingKey = await doProvider.getSSHKey(keyPair.fingerprint);
      if (existingKey) {
        this.logger.info(`✅ SSH key already exists in DigitalOcean with name: ${existingKey.name}`);
        this.logger.info(`   Key ID: ${existingKey.id}`);
        this.logger.info(`   Fingerprint: ${existingKey.fingerprint}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Upload key pair to DigitalOcean
   */
  private async uploadToDigitalOcean(keyPair: { publicKey: string; fingerprint: string }, keyName: string): Promise<void> {
    this.logger.info(`Uploading SSH key to DigitalOcean...`);

    if (this.dryRun) {
      this.logDryRun(`upload SSH key ${keyName} to DigitalOcean`);
      return;
    }

    const doProvider = createDigitalOceanProvider(
      this.config.secrets.digitalOceanToken,
      this.logger
    );

    try {
      const uploadedKey = await doProvider.createSSHKey({
        name: keyName,
        publicKey: keyPair.publicKey,
      });

      this.logger.info(`✅ SSH key uploaded to DigitalOcean`);
      this.logger.info(`   Key ID: ${uploadedKey.id}`);
      this.logger.info(`   Fingerprint: ${uploadedKey.fingerprint}`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        // Key already exists, get its info
        const existingKey = await doProvider.getSSHKey(keyPair.fingerprint);
        if (existingKey) {
          this.logger.info(`✅ SSH key already exists in DigitalOcean`);
          this.logger.info(`   Key ID: ${existingKey.id}`);
          this.logger.info(`   Fingerprint: ${existingKey.fingerprint}`);
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
  }

  /**
   * Output environment variable for the SSH key
   */
  private outputEnvironmentVariable(keyId: string): void {
    this.logger.info('');
    this.logger.info('Add this to your .env file:');
    this.logger.info(`DYNIA_SSH_KEY_ID=${keyId}`);
    this.logger.info('');
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
    
    if (!this.config.secrets.digitalOceanToken) {
      throw new Error('DYNIA_DO_TOKEN environment variable is required to upload SSH keys');
    }
  }
}