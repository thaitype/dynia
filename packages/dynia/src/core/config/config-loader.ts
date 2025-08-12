import type { ILogger } from '@thaitype/core-utils';
import { z } from 'zod';

import type { PublicConfig, RuntimeConfig, SecretConfig } from '../../shared/types/index.js';

/**
 * Schema for validating required environment variables
 */
const SecretConfigSchema = z.object({
  digitalOceanToken: z.string().min(1, 'DYNIA_DO_TOKEN is required'),
  cloudflareToken: z.string().min(1, 'DYNIA_CF_TOKEN is required'),
  cloudflareZoneId: z.string().min(1, 'DYNIA_CF_ZONE_ID is required'),
  sshKeyId: z.string().min(1, 'DYNIA_SSH_KEY_ID is required'),
});

/**
 * Schema for validating environment variables with optional SSH key
 */
const SecretConfigSchemaOptionalSSH = z.object({
  digitalOceanToken: z.string().min(1, 'DYNIA_DO_TOKEN is required'),
  cloudflareToken: z.string().optional(),
  cloudflareZoneId: z.string().optional(),
  sshKeyId: z.string().optional(),
});

/**
 * Default public configuration - no secrets here
 */
const DEFAULT_PUBLIC_CONFIG: PublicConfig = {
  digitalOcean: {
    region: 'nyc3',
    size: 's-1vcpu-1gb',
  },
  cloudflare: {
    domain: 'example.com', // Will be overridden by user
  },
  docker: {
    host: undefined,
    certPath: undefined,
  },
  stateDir: '.dynia',
};

/**
 * Loads and validates configuration from environment variables
 * Keeps secrets separate from public configuration
 */
export class ConfigLoader {
  constructor(private readonly logger: ILogger) {}

  /**
   * Load secrets from environment variables with validation
   */
  private loadSecrets(): SecretConfig {
    try {
      const secrets = {
        digitalOceanToken: process.env.DYNIA_DO_TOKEN || '',
        cloudflareToken: process.env.DYNIA_CF_TOKEN || '',
        cloudflareZoneId: process.env.DYNIA_CF_ZONE_ID || '',
        sshKeyId: process.env.DYNIA_SSH_KEY_ID || '',
      };

      return SecretConfigSchema.parse(secrets);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const missingVars = error.issues.map(issue => {
          const field = issue.path[0];
          const envVar = this.fieldToEnvVar(field as string);
          return `${envVar}`;
        });

        throw new Error(
          `Missing required environment variables:\n${missingVars.map(v => `  - ${v}`).join('\n')}\n\n` +
            'Please set these environment variables before running Dynia.'
        );
      }
      throw error;
    }
  }

  /**
   * Load secrets from environment variables with optional SSH key
   */
  private loadSecretsWithOptionalSSHKey(): SecretConfig {
    try {
      const secrets = {
        digitalOceanToken: process.env.DYNIA_DO_TOKEN || '',
        cloudflareToken: process.env.DYNIA_CF_TOKEN || '',
        cloudflareZoneId: process.env.DYNIA_CF_ZONE_ID || '',
        sshKeyId: process.env.DYNIA_SSH_KEY_ID || '',
      };

      const parsed = SecretConfigSchemaOptionalSSH.parse(secrets);

      // Ensure all required fields for SecretConfig interface exist
      return {
        digitalOceanToken: parsed.digitalOceanToken,
        cloudflareToken: parsed.cloudflareToken || '',
        cloudflareZoneId: parsed.cloudflareZoneId || '',
        sshKeyId: parsed.sshKeyId || '',
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const missingVars = error.issues.map(issue => {
          const field = issue.path[0];
          const envVar = this.fieldToEnvVar(field as string);
          return `${envVar}`;
        });

        throw new Error(
          `Missing required environment variables for SSH command:\n${missingVars.map(v => `  - ${v}`).join('\n')}\n\n` +
            'Please set these environment variables before running SSH commands.'
        );
      }
      throw error;
    }
  }

  /**
   * Load public configuration with defaults
   */
  private loadPublicConfig(): PublicConfig {
    // Start with defaults and allow overrides for non-sensitive config
    const config = { ...DEFAULT_PUBLIC_CONFIG };

    // Only override domain if provided, since it's often project-specific
    if (process.env.DYNIA_CF_DOMAIN) {
      config.cloudflare.domain = process.env.DYNIA_CF_DOMAIN;
    }

    this.logger.debug(`Using config: region=${config.digitalOcean.region}, size=${config.digitalOcean.size}`);

    return config;
  }

  /**
   * Load complete runtime configuration
   */
  loadConfig(): RuntimeConfig {
    this.logger.debug('Loading configuration...');

    const secrets = this.loadSecrets();
    const publicConfig = this.loadPublicConfig();

    this.logger.debug('Configuration loaded successfully');

    return {
      secrets,
      public: publicConfig,
    };
  }

  /**
   * Load configuration with optional SSH key ID (for SSH commands)
   */
  loadConfigWithOptionalSSHKey(): RuntimeConfig {
    this.logger.debug('Loading configuration with optional SSH key...');

    const secrets = this.loadSecretsWithOptionalSSHKey();
    const publicConfig = this.loadPublicConfig();

    this.logger.debug('Configuration loaded successfully');

    return {
      secrets,
      public: publicConfig,
    };
  }

  /**
   * Validate that all required secrets are present
   */
  validateSecrets(): void {
    this.loadSecrets(); // Will throw if validation fails
  }

  /**
   * Map field names to environment variable names
   */
  private fieldToEnvVar(field: string): string {
    const mapping: Record<string, string> = {
      digitalOceanToken: 'DYNIA_DO_TOKEN',
      cloudflareToken: 'DYNIA_CF_TOKEN',
      cloudflareZoneId: 'DYNIA_CF_ZONE_ID',
      sshKeyId: 'DYNIA_SSH_KEY_ID',
    };

    return mapping[field] || field;
  }

  /**
   * Get default configuration for testing or documentation
   */
  static getDefaults(): PublicConfig {
    return { ...DEFAULT_PUBLIC_CONFIG };
  }

  /**
   * Get list of required environment variables
   */
  static getRequiredEnvVars(): string[] {
    return ['DYNIA_DO_TOKEN', 'DYNIA_CF_TOKEN', 'DYNIA_CF_ZONE_ID', 'DYNIA_SSH_KEY_ID'];
  }
}
