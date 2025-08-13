import { BaseCommand } from '../../shared/base/base-command.js';
import { Table } from 'console-table-printer';

/**
 * Command to list all clusters
 */
export class ClusterListCommand extends BaseCommand<{}> {
  protected async run(): Promise<void> {
    this.logger.info('Listing all clusters...');

    const clusters = await this.stateManager.getClusters();
    
    if (clusters.length === 0) {
      this.logger.info('No clusters found. Create your first cluster with:');
      this.logger.info('  dynia cluster create-ha --name myapp --base-domain example.com');
      return;
    }

    this.logger.info(`Found ${clusters.length} cluster${clusters.length === 1 ? '' : 's'}:\n`);

    // Display clusters in table format
    const table = new Table({
      columns: [
        { name: 'name', title: 'Name', alignment: 'left' },
        { name: 'reservedIp', title: 'Reserved IP', alignment: 'left' },
        { name: 'baseDomain', title: 'Base Domain', alignment: 'left' },
        { name: 'region', title: 'Region', alignment: 'center' },
        { name: 'activeNode', title: 'Active Node', alignment: 'center' }
      ]
    });

    clusters.forEach(cluster => {
      table.addRow({
        name: cluster.name,
        reservedIp: cluster.reservedIp || 'Not assigned',
        baseDomain: cluster.baseDomain,
        region: cluster.region,
        activeNode: cluster.activeNodeId || 'None'
      });
    });

    table.printTable();
    
    // Show additional details
    console.log('\nFor more details, use:');
    console.log('  dynia cluster node list <cluster-name>  # Show cluster nodes');
    console.log('  dynia cluster routes list <cluster-name> # Show cluster routes (when implemented)');
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
  }
}