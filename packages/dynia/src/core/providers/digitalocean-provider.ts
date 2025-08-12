import type { ILogger } from '@thaitype/core-utils';

import { Helpers } from '../../shared/utils/helpers.js';
import type { DropletInfo, IDigitalOceanProvider, ReservedIpInfo, SSHKeyInfo, VpcInfo } from './interfaces.js';

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

  // Reserved IP management

  /**
   * Create a new Reserved IP in specified region
   */
  async createReservedIp(region: string): Promise<ReservedIpInfo> {
    this.logger.info(`Creating Reserved IP in region: ${region}`);

    const body = {
      region,
      type: 'reserve',
    };

    const response = await this.apiRequest('POST', '/reserved_ips', body);
    const reservedIp = response.reserved_ip;

    const result = this.mapReservedIpResponse(reservedIp);
    this.logger.info(`✅ Created Reserved IP: ${result.ip} (${result.id})`);
    return result;
  }


  /**
   * List all Reserved IPs
   */
  async listReservedIps(): Promise<ReservedIpInfo[]> {
    this.logger.debug('Listing Reserved IPs');

    const response = await this.apiRequest('GET', '/reserved_ips');
    const reservedIps = response.reserved_ips || [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return reservedIps.map((ip: any) => this.mapReservedIpResponse(ip));
  }


  /**
   * Assign Reserved IP to a droplet
   */
  async assignReservedIp(reservedIpId: string, dropletId: string): Promise<void> {
    this.logger.info(`Assigning Reserved IP ${reservedIpId} to droplet ${dropletId}`);

    const body = {
      // resource_type: 'droplet',
      droplet_id: parseInt(dropletId, 10), // DigitalOcean API expects numeric droplet ID
    };

    await this.apiRequest('POST', `/reserved_ips/${reservedIpId}/actions`, {
      type: 'assign',
      ...body,
    });

    this.logger.info(`✅ Reserved IP ${reservedIpId} assigned to droplet ${dropletId}`);
  }

  /**
   * Unassign Reserved IP from current droplet
   */
  async unassignReservedIp(reservedIpId: string): Promise<void> {
    this.logger.info(`Unassigning Reserved IP: ${reservedIpId}`);

    await this.apiRequest('POST', `/reserved_ips/${reservedIpId}/actions`, {
      type: 'unassign',
    });

    this.logger.info(`✅ Reserved IP ${reservedIpId} unassigned`);
  }


  // VPC management

  /**
   * Create a new VPC in specified region
   */
  async createVpc(options: {
    name: string;
    region: string;
    ipRange?: string;
  }): Promise<VpcInfo> {
    this.logger.info(`Creating VPC: ${options.name} in ${options.region}`);

    const body = {
      name: options.name,
      region: options.region,
      ip_range: options.ipRange || '10.10.0.0/16',
    };

    const response = await this.apiRequest('POST', '/vpcs', body);
    const vpc = response.vpc;

    const result = this.mapVpcResponse(vpc);
    this.logger.info(`✅ Created VPC: ${result.name} (${result.id})`);
    return result;
  }

  /**
   * List all VPCs
   */
  async listVpcs(): Promise<VpcInfo[]> {
    this.logger.debug('Listing VPCs');

    const response = await this.apiRequest('GET', '/vpcs');
    const vpcs = response.vpcs || [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return vpcs.map((vpc: any) => this.mapVpcResponse(vpc));
  }

  /**
   * Get VPC information by ID
   */
  async getVpc(vpcId: string): Promise<VpcInfo> {
    this.logger.debug(`Getting VPC: ${vpcId}`);

    const response = await this.apiRequest('GET', `/vpcs/${vpcId}`);
    return this.mapVpcResponse(response.vpc);
  }

  /**
   * Delete VPC
   */
  async deleteVpc(vpcId: string): Promise<void> {
    this.logger.info(`Deleting VPC: ${vpcId}`);

    await this.apiRequest('DELETE', `/vpcs/${vpcId}`);
    this.logger.info(`✅ VPC ${vpcId} deleted`);
  }

  /**
   * Make an API request to DigitalOcean
   */
  private async apiRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    body?: unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<{ [key: string]: any }> {
    const url = `${this.baseUrl}${endpoint}`;

    this.logger.debug(`DO API: ${method} ${endpoint}`);

    console.log(`body:`, body);

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

  /**
   * Map DigitalOcean API Reserved IP response to our interface
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapReservedIpResponse(reservedIp: any): ReservedIpInfo {
    return {
      id: reservedIp.ip, // Reserved IPs use IP as ID in DO API
      ip: reservedIp.ip,
      region: reservedIp.region?.slug || '',
      dropletId: reservedIp.droplet?.id?.toString() || undefined,
    };
  }

  /**
   * Map DigitalOcean API VPC response to our interface
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapVpcResponse(vpc: any): VpcInfo {
    return {
      id: vpc.id,
      name: vpc.name,
      region: vpc.region,
      ipRange: vpc.ip_range,
    };
  }
}

/**
 * Factory function to create DigitalOcean provider
 */
export function createDigitalOceanProvider(token: string, logger: ILogger): IDigitalOceanProvider {
  return new DigitalOceanProvider(token, logger);
}
