import { BaseCommand } from '../../shared/base/base-command.js';
import { Helpers } from '../../shared/utils/helpers.js';
import { Table } from 'console-table-printer';

/**
 * Command to list all nodes
 */
export class NodeListCommand extends BaseCommand {
  protected async run(): Promise<void> {
    const nodes = await this.stateManager.getNodes();

    if (nodes.length === 0) {
      this.logger.info('No nodes found.');
      return;
    }

    this.logger.info(`Found ${nodes.length} node(s):\n`);

    // Display nodes in a table format
    const rows = nodes.map(node => ({
      Name: node.name,
      Status: this.formatStatus(node.status),
      IP: node.ip,
      FQDN: node.fqdn,
      'Health Path': node.healthPath,
      Created: Helpers.formatTimestamp(node.createdAt),
      'Caddy Target': `${node.caddy.target.service}:${node.caddy.target.port}`,
    }));

    // Simple table formatting
    this.displayTable(rows);
  }

  private formatStatus(status: string): string {
    const statusSymbols = {
      active: '🟢 Active',
      inactive: '🔴 Inactive',
      provisioning: '🟡 Provisioning',
      failed: '❌ Failed',
      // Progressive creation states
      'droplet-created': '🟠 Droplet Created',
      'dns-configured': '🟠 DNS Configured',
      'dns-ready': '🟠 DNS Ready',
      'infrastructure-ready': '🟠 Infrastructure Ready',
    };

    return statusSymbols[status as keyof typeof statusSymbols] || status;
  }

  private displayTable(rows: Array<Record<string, string>>): void {
    if (rows.length === 0) return;

    const keys = Object.keys(rows[0]);
    
    // Create table with dynamic columns
    const table = new Table({
      columns: keys.map(key => ({
        name: key,
        title: key,
        alignment: 'left' as const
      }))
    });

    // Add all rows to table
    rows.forEach(row => {
      // Truncate long values to prevent overly wide tables
      const truncatedRow = keys.reduce((acc, key) => {
        const value = row[key] || '';
        acc[key] = value.length > 50 ? Helpers.truncate(value, 50) : value;
        return acc;
      }, {} as Record<string, string>);
      
      table.addRow(truncatedRow);
    });

    table.printTable();
    console.log(''); // Empty line after table
  }
}
