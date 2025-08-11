import type { ILogger } from '@thaitype/core-utils';

import type { IDigitalOceanProvider, DropletInfo } from './interfaces.js';
import { Helpers } from '../../shared/utils/helpers.js';

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
      'Authorization': `Bearer ${this.token}`,
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
   * Make an API request to DigitalOcean
   */
  private async apiRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    body?: unknown
  ): Promise<any> {
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
  private mapDropletResponse(droplet: any): DropletInfo {
    // Find the public IPv4 address
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
}

/**
 * Factory function to create DigitalOcean provider
 */
export function createDigitalOceanProvider(
  token: string,
  logger: ILogger
): IDigitalOceanProvider {
  return new DigitalOceanProvider(token, logger);
}