import { BaseCommand } from '../../shared/base/base-command.js';
import { Helpers } from '../../shared/utils/helpers.js';

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
    };
    
    return statusSymbols[status as keyof typeof statusSymbols] || status;
  }

  private displayTable(rows: Array<Record<string, string>>): void {
    if (rows.length === 0) return;

    // Get column widths
    const keys = Object.keys(rows[0]);
    const widths = keys.reduce((acc, key) => {
      const maxWidth = Math.max(
        key.length,
        ...rows.map(row => row[key]?.length || 0)
      );
      acc[key] = Math.min(maxWidth, 50); // Cap at 50 chars
      return acc;
    }, {} as Record<string, number>);

    // Print header
    const header = keys.map(key => key.padEnd(widths[key])).join(' | ');
    console.log(header);
    console.log(keys.map(key => '-'.repeat(widths[key])).join('-|-'));

    // Print rows
    for (const row of rows) {
      const line = keys.map(key => {
        const value = row[key] || '';
        return value.length > widths[key] 
          ? Helpers.truncate(value, widths[key])
          : value.padEnd(widths[key]);
      }).join(' | ');
      console.log(line);
    }

    console.log(''); // Empty line after table
  }
}