import type { ILogger } from '@thaitype/core-utils';

import type { ICloudflareProvider, DnsRecord } from './interfaces.js';
import { Helpers } from '../../shared/utils/helpers.js';

/**
 * Cloudflare provider implementation using Cloudflare API v4
 */
export class CloudflareProvider implements ICloudflareProvider {
  private readonly baseUrl = 'https://api.cloudflare.com/client/v4';
  private readonly headers: Record<string, string>;

  constructor(
    private readonly token: string,
    private readonly zoneId: string,
    private readonly logger: ILogger
  ) {
    this.headers = {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Create or update an A record
   */
  async upsertARecord(options: {
    name: string;
    ip: string;
    ttl?: number;
    proxied?: boolean;
  }): Promise<DnsRecord> {
    const { name, ip, ttl = 300, proxied = false } = options;
    this.logger.info(`Upserting DNS A record: ${name} → ${ip}`);

    // First, check if record already exists
    const existingRecord = await this.getDnsRecord(name);

    if (existingRecord) {
      this.logger.debug(`Updating existing DNS record: ${existingRecord.id}`);
      return await this.updateDnsRecord(existingRecord.id, {
        type: 'A',
        name,
        content: ip,
        ttl,
        proxied,
      });
    } else {
      this.logger.debug(`Creating new DNS A record for ${name}`);
      return await this.createDnsRecord({
        type: 'A',
        name,
        content: ip,
        ttl,
        proxied,
      });
    }
  }

  /**
   * Get DNS record by name
   */
  async getDnsRecord(name: string): Promise<DnsRecord | null> {
    this.logger.debug(`Looking up DNS record: ${name}`);

    const response = await this.apiRequest('GET', `/zones/${this.zoneId}/dns_records?type=A&name=${encodeURIComponent(name)}`);
    
    if (response.result && response.result.length > 0) {
      return this.mapDnsRecordResponse(response.result[0]);
    }

    return null;
  }

  /**
   * Delete DNS record
   */
  async deleteDnsRecord(recordId: string): Promise<void> {
    this.logger.info(`Deleting DNS record: ${recordId}`);

    await this.apiRequest('DELETE', `/zones/${this.zoneId}/dns_records/${recordId}`);
    this.logger.info(`DNS record ${recordId} deleted successfully`);
  }

  /**
   * Wait for DNS propagation to specified resolvers
   */
  async waitForDnsPropagation(fqdn: string, expectedIp: string, timeoutMs = 120000): Promise<void> {
    this.logger.info(`Waiting for DNS propagation: ${fqdn} → ${expectedIp}`);

    const resolvers = ['1.1.1.1', '8.8.8.8'];
    
    await Helpers.waitFor(
      async () => {
        const results = await Promise.allSettled(
          resolvers.map(resolver => this.queryDnsResolver(fqdn, resolver))
        );

        const resolved = results
          .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
          .map(result => result.value);

        this.logger.debug(`DNS resolution results: ${resolved.join(', ')}`);

        // All resolvers should return the expected IP
        return resolved.length === resolvers.length && 
               resolved.every(ip => ip === expectedIp);
      },
      {
        timeout: timeoutMs,
        interval: 5000, // Check every 5 seconds
        description: `DNS propagation for ${fqdn}`,
      }
    );

    this.logger.info(`✅ DNS propagation completed for ${fqdn}`);
  }

  /**
   * Deploy Cloudflare Worker (placeholder for MVP - not implemented)
   */
  async deployWorker(_options: { scriptName: string; origins: string[] }): Promise<void> {
    throw new Error('Worker deployment not implemented in MVP. Please configure your load balancer manually.');
  }

  /**
   * Create a new DNS record
   */
  private async createDnsRecord(recordData: {
    type: string;
    name: string;
    content: string;
    ttl: number;
    proxied: boolean;
  }): Promise<DnsRecord> {
    const response = await this.apiRequest('POST', `/zones/${this.zoneId}/dns_records`, recordData);
    return this.mapDnsRecordResponse(response.result);
  }

  /**
   * Update an existing DNS record
   */
  private async updateDnsRecord(recordId: string, recordData: {
    type: string;
    name: string;
    content: string;
    ttl: number;
    proxied: boolean;
  }): Promise<DnsRecord> {
    const response = await this.apiRequest('PUT', `/zones/${this.zoneId}/dns_records/${recordId}`, recordData);
    return this.mapDnsRecordResponse(response.result);
  }

  /**
   * Query a specific DNS resolver
   */
  private async queryDnsResolver(fqdn: string, resolver: string): Promise<string> {
    // Use DNS over HTTPS (DoH) to query the resolver
    const dohUrl = `https://${resolver}/dns-query?name=${encodeURIComponent(fqdn)}&type=A`;
    
    const response = await fetch(dohUrl, {
      headers: {
        'Accept': 'application/dns-json',
      },
    });

    if (!response.ok) {
      throw new Error(`DNS query failed: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.Answer && data.Answer.length > 0) {
      // Return the first A record
      const aRecord = data.Answer.find((answer: any) => answer.type === 1);
      if (aRecord) {
        return aRecord.data;
      }
    }

    throw new Error(`No A record found for ${fqdn}`);
  }

  /**
   * Make an API request to Cloudflare
   */
  private async apiRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    endpoint: string,
    body?: unknown
  ): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    
    this.logger.debug(`CF API: ${method} ${endpoint}`);

    const response = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseData = await response.json();

    if (!response.ok || !responseData.success) {
      let errorMessage = `Cloudflare API error: ${response.status}`;
      
      if (responseData.errors && responseData.errors.length > 0) {
        errorMessage += ` - ${responseData.errors.map((e: any) => e.message).join(', ')}`;
      }

      throw new Error(errorMessage);
    }

    return responseData;
  }

  /**
   * Map Cloudflare API DNS record response to our interface
   */
  private mapDnsRecordResponse(record: any): DnsRecord {
    return {
      id: record.id,
      type: record.type,
      name: record.name,
      value: record.content,
      ttl: record.ttl,
      proxied: record.proxied || false,
    };
  }
}

/**
 * Factory function to create Cloudflare provider
 */
export function createCloudflareProvider(
  token: string,
  zoneId: string,
  logger: ILogger
): ICloudflareProvider {
  return new CloudflareProvider(token, zoneId, logger);
}