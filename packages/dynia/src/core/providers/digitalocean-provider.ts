import type { ILogger } from '@thaitype/core-utils';

import { Helpers } from '../../shared/utils/helpers.js';
import type { DropletInfo, IDigitalOceanProvider, SSHKeyInfo } from './interfaces.js';

/**
 * DigitalOcean provider implementation using DO API v2
 */
export class DigitalOceanProvider implements IDigitalOceanProvider {
  private readonly baseUrl = 'https://api.digitalocean.com/v2';
  private readonly headers: Record<string, string>;

  constructor(
    private readonly token: string,
    private readonly logger: ILogger
  ) {
    this.headers = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create a new droplet
   */
  async createDroplet(options: {
    name: string;
    region: string;
    size: string;
    image: string;
    sshKeys?: string[];
  }): Promise<DropletInfo> {
    this.logger.info(`Creating DigitalOcean droplet: ${options.name}`);

    const body = {
      name: options.name,
      region: options.region,
      size: options.size,
      image: options.image,
      ssh_keys: options.sshKeys || [],
      backups: false,
      ipv6: false,
      monitoring: true,
      tags: ['dynia', 'cluster'],
    };

    const response = await this.apiRequest('POST', '/droplets', body);
    const droplet = response.droplet;

    return this.mapDropletResponse(droplet);
  }

  /**
   * Get droplet information by ID
   */
  async getDroplet(dropletId: string): Promise<DropletInfo> {
    this.logger.debug(`Getting droplet info: ${dropletId}`);

    const response = await this.apiRequest('GET', `/droplets/${dropletId}`);
    return this.mapDropletResponse(response.droplet);
  }

  /**
   * Delete a droplet
   */
  async deleteDroplet(dropletId: string): Promise<void> {
    this.logger.info(`Deleting droplet: ${dropletId}`);

    await this.apiRequest('DELETE', `/droplets/${dropletId}`);
    this.logger.info(`Droplet ${dropletId} deletion initiated`);
  }

  /**
   * Wait for droplet to reach active status
   */
  async waitForDropletActive(dropletId: string, timeoutMs = 300000): Promise<DropletInfo> {
    this.logger.info(`Waiting for droplet ${dropletId} to become active...`);

    const startTime = Date.now();

    await Helpers.waitFor(
      async () => {
        const droplet = await this.getDroplet(dropletId);
        this.logger.debug(`Droplet ${dropletId} status: ${droplet.status}`);
        return droplet.status === 'active';
      },
      {
        timeout: timeoutMs,
        interval: 10000, // Check every 10 seconds
        description: `droplet ${dropletId} to become active`,
      }
    );

    const droplet = await this.getDroplet(dropletId);
    const duration = Date.now() - startTime;
    this.logger.info(`✅ Droplet ${dropletId} is now active (took ${Math.round(duration / 1000)}s)`);

    return droplet;
  }

  /**
   * Create SSH key in DigitalOcean account
   */
  async createSSHKey(options: { name: string; publicKey: string }): Promise<SSHKeyInfo> {
    this.logger.info(`Creating SSH key: ${options.name}`);

    const body = {
      name: options.name,
      public_key: options.publicKey,
    };

    const response = await this.apiRequest('POST', '/account/keys', body);
    const sshKey = response.ssh_key;

    return this.mapSSHKeyResponse(sshKey);
  }

  /**
   * List SSH keys in DigitalOcean account
   */
  async listSSHKeys(): Promise<SSHKeyInfo[]> {
    this.logger.debug('Listing SSH keys');

    const response = await this.apiRequest('GET', '/account/keys');
    const sshKeys = response.ssh_keys || [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return sshKeys.map((key: any) => this.mapSSHKeyResponse(key));
  }

  /**
   * Get SSH key by ID or fingerprint
   */
  async getSSHKey(idOrFingerprint: string): Promise<SSHKeyInfo | null> {
    this.logger.debug(`Getting SSH key: ${idOrFingerprint}`);

    try {
      const response = await this.apiRequest('GET', `/account/keys/${idOrFingerprint}`);
      return this.mapSSHKeyResponse(response.ssh_key);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_error) {
      this.logger.debug(`SSH key not found: ${idOrFingerprint}`);
      return null;
    }
  }

  /**
   * Delete SSH key from DigitalOcean account
   */
  async deleteSSHKey(idOrFingerprint: string): Promise<void> {
    this.logger.info(`Deleting SSH key: ${idOrFingerprint}`);

    await this.apiRequest('DELETE', `/account/keys/${idOrFingerprint}`);
    this.logger.info(`SSH key ${idOrFingerprint} deletion completed`);
  }

  /**
   * Make an API request to DigitalOcean
   */
  private async apiRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    body?: unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<{ droplet?: any; droplets?: any; ssh_key?: any; ssh_keys?: any }> {
    const url = `${this.baseUrl}${endpoint}`;

    this.logger.debug(`DO API: ${method} ${endpoint}`);

    const response = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let errorMessage = `DigitalOcean API error: ${response.status} ${response.statusText}`;

      try {
        const errorBody = await response.json();
        if (errorBody.message) {
          errorMessage += ` - ${errorBody.message}`;
        }
      } catch {
        // Ignore JSON parsing errors for error responses
      }

      throw new Error(errorMessage);
    }

    // DELETE requests typically return empty responses
    if (response.status === 204) {
      return {};
    }

    return await response.json();
  }

  /**
   * Map DigitalOcean API droplet response to our interface
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapDropletResponse(droplet: any): DropletInfo {
    // Find the public IPv4 address
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const publicNetwork = droplet.networks?.v4?.find((network: any) => network.type === 'public');
    const ip = publicNetwork?.ip_address || '';

    return {
      id: droplet.id.toString(),
      name: droplet.name,
      ip,
      region: droplet.region?.slug || '',
      size: droplet.size_slug || droplet.size?.slug || '',
      status: this.mapDropletStatus(droplet.status),
    };
  }

  /**
   * Map DigitalOcean droplet status to our status enum
   */
  private mapDropletStatus(status: string): DropletInfo['status'] {
    switch (status) {
      case 'new':
        return 'new';
      case 'active':
        return 'active';
      case 'off':
        return 'off';
      case 'archive':
        return 'archive';
      default:
        return 'new'; // Default fallback
    }
  }

  /**
   * Map DigitalOcean API SSH key response to our interface
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapSSHKeyResponse(sshKey: any): SSHKeyInfo {
    return {
      id: sshKey.id.toString(),
      name: sshKey.name,
      fingerprint: sshKey.fingerprint,
      publicKey: sshKey.public_key,
    };
  }
}

/**
 * Factory function to create DigitalOcean provider
 */
export function createDigitalOceanProvider(token: string, logger: ILogger): IDigitalOceanProvider {
  return new DigitalOceanProvider(token, logger);
}
