import type { ILogger } from '@thaitype/core-utils';
import type { IDigitalOceanProvider } from '../../core/providers/interfaces.js';

export interface ReservedIpAssignmentResult {
  ip: string;
  id: string;
}

/**
 * Shared service for Reserved IP assignment logic
 * Handles the unified flow: Find available → Use existing OR create new → Assign
 */
export class ReservedIpService {
  constructor(
    private readonly doProvider: IDigitalOceanProvider,
    private readonly logger: ILogger
  ) {}

  /**
   * Assign a Reserved IP to a droplet using the unified logic
   * 1. Find available unassigned Reserved IPs in region
   * 2. If found: use existing IP
   * 3. If none: create new unassigned IP  
   * 4. Assign the IP to the droplet
   */
  async assignReservedIpToDroplet(
    dropletId: string, 
    region: string
  ): Promise<ReservedIpAssignmentResult> {
    this.logger.info(`Assigning Reserved IP to droplet ${dropletId} in region ${region}...`);

    // Step 1: Try to find existing unassigned Reserved IP in the region
    const availableIps = await this.findAvailableReservedIps(region);
    
    let targetIp: { ip: string; id: string };

    if (availableIps.length > 0) {
      // Step 2: Use existing unassigned IP
      targetIp = availableIps[0];
      this.logger.info(`Found existing unassigned Reserved IP: ${targetIp.ip}`);
    } else {
      // Step 3: Create new unassigned Reserved IP
      this.logger.info(`No available Reserved IPs found in ${region}, creating new one...`);
      targetIp = await this.doProvider.createReservedIp(region);
      this.logger.info(`✅ Created new Reserved IP: ${targetIp.ip}`);
    }

    // Step 4: Assign the IP to the droplet
    await this.doProvider.assignReservedIp(targetIp.id, dropletId);
    this.logger.info(`✅ Reserved IP ${targetIp.ip} assigned to droplet ${dropletId}`);

    return {
      ip: targetIp.ip,
      id: targetIp.id,
    };
  }

  /**
   * Find available (unassigned) Reserved IPs in a specific region
   */
  private async findAvailableReservedIps(region: string): Promise<Array<{ ip: string; id: string }>> {
    this.logger.debug(`Looking for available Reserved IPs in region: ${region}`);

    const allReservedIps = await this.doProvider.listReservedIps();
    
    // Filter for IPs in the correct region that are not assigned to any droplet
    const availableIps = allReservedIps.filter(ip => 
      ip.region === region && !ip.dropletId
    );

    this.logger.debug(`Found ${availableIps.length} available Reserved IPs in ${region}`);

    return availableIps.map(ip => ({
      ip: ip.ip,
      id: ip.id,
    }));
  }

  /**
   * Reassign an existing Reserved IP to a different droplet
   * Used when a cluster already has a Reserved IP but needs to move it
   */
  async reassignReservedIp(
    reservedIpId: string, 
    newDropletId: string
  ): Promise<void> {
    this.logger.info(`Reassigning Reserved IP ${reservedIpId} to droplet ${newDropletId}...`);

    // DigitalOcean automatically unassigns from current droplet when assigning to new one
    await this.doProvider.assignReservedIp(reservedIpId, newDropletId);
    
    this.logger.info(`✅ Reserved IP ${reservedIpId} reassigned to droplet ${newDropletId}`);
  }
}