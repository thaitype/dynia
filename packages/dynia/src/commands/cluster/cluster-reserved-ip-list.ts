import { BaseCommand } from '../../shared/base/base-command.js';
import { createDigitalOceanProvider } from '../../core/providers/digitalocean-provider.js';
import { Table } from 'console-table-printer';

export interface ClusterReservedIpListOptions {
  region?: string;
  status: string;
}

/**
 * Command to list all Reserved IPs and their assignment status
 * Useful for debugging and managing Reserved IP assignments
 */
export class ClusterReservedIpListCommand extends BaseCommand<ClusterReservedIpListOptions> {
  protected async run(): Promise<void> {
    const { region, status = 'all' } = this.argv;

    this.logger.info('Listing Reserved IPs...');

    const doProvider = createDigitalOceanProvider(
      this.config.secrets.digitalOceanToken,
      this.logger
    );

    try {
      // Get all Reserved IPs
      const allReservedIps = await doProvider.listReservedIps();
      
      if (allReservedIps.length === 0) {
        this.logger.info('No Reserved IPs found in your DigitalOcean account.');
        this.logger.info('You can create one with: dynia cluster reserved-ip assign --name <name> --node <node-id>');
        return;
      }

      // Filter by region if specified
      let filteredIps = allReservedIps;
      if (region) {
        filteredIps = allReservedIps.filter(ip => ip.region === region);
        if (filteredIps.length === 0) {
          this.logger.info(`No Reserved IPs found in region: ${region}`);
          return;
        }
      }

      // Filter by status if specified
      if (status === 'assigned') {
        filteredIps = filteredIps.filter(ip => ip.dropletId);
      } else if (status === 'unassigned') {
        filteredIps = filteredIps.filter(ip => !ip.dropletId);
      }

      if (filteredIps.length === 0) {
        this.logger.info(`No Reserved IPs found with status: ${status}`);
        return;
      }

      // Display summary
      const assignedCount = filteredIps.filter(ip => ip.dropletId).length;
      const unassignedCount = filteredIps.length - assignedCount;
      
      this.logger.info(`Found ${filteredIps.length} Reserved IP${filteredIps.length === 1 ? '' : 's'}:`);
      this.logger.info(`  Assigned: ${assignedCount}, Unassigned: ${unassignedCount}\n`);

      // Display table
      const table = new Table({
        columns: [
          { name: 'ipAddress', title: 'IP Address', alignment: 'left' },
          { name: 'region', title: 'Region', alignment: 'center' },
          { name: 'assignedTo', title: 'Assigned To', alignment: 'left' },
          { name: 'status', title: 'Status', alignment: 'center' }
        ]
      });

      // Display each Reserved IP
      for (const ip of filteredIps) {
        let assignedTo = 'None';
        let statusIcon = '🟡';
        
        if (ip.dropletId) {
          // Try to get droplet info to show name instead of ID
          try {
            const droplet = await doProvider.getDroplet(ip.dropletId);
            assignedTo = droplet.name;
            statusIcon = droplet.status === 'active' ? '🟢' : '🟠';
          } catch {
            // If we can't get droplet info, just show the ID
            assignedTo = `Droplet-${ip.dropletId}`;
            statusIcon = '🟠';
          }
        }
        
        const statusStr = ip.dropletId 
          ? `${statusIcon} Assigned`
          : `🆓 Available`;
        
        table.addRow({
          ipAddress: ip.ip,
          region: ip.region,
          assignedTo: assignedTo,
          status: statusStr
        });
      }
      
      table.printTable();

      // Show available actions
      console.log('\nUseful commands:');
      if (unassignedCount > 0) {
        console.log('  dynia cluster reserved-ip assign --name <name> --node <node-id>  # Assign to cluster');
      }
      console.log('  dynia cluster list  # Show clusters and their Reserved IP assignments');
      
      if (region) {
        console.log(`  dynia cluster reserved-ip list  # Show all regions`);
      } else {
        console.log(`  dynia cluster reserved-ip list --region <region>  # Filter by region`);
      }

    } catch (error) {
      this.logger.error(`Failed to list Reserved IPs: ${error}`);
      throw new Error('Unable to retrieve Reserved IP information from DigitalOcean');
    }
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
    
    if (!this.config.secrets.digitalOceanToken) {
      throw new Error('DYNIA_DO_TOKEN environment variable is required');
    }
  }
}