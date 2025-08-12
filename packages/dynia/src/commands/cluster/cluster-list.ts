import { BaseCommand } from '../../shared/base/base-command.js';

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
    console.log('┌─────────────────┬──────────────────┬─────────────────┬──────────────┬─────────────┐');
    console.log('│ Name            │ Reserved IP      │ Base Domain     │ Region       │ Active Node │');
    console.log('├─────────────────┼──────────────────┼─────────────────┼──────────────┼─────────────┤');
    
    for (const cluster of clusters) {
      const name = cluster.name.padEnd(15).substring(0, 15);
      const reservedIp = (cluster.reservedIp || 'Not assigned').padEnd(16).substring(0, 16);
      const baseDomain = cluster.baseDomain.padEnd(15).substring(0, 15);
      const region = cluster.region.padEnd(12).substring(0, 12);
      const activeNode = (cluster.activeNodeId || 'None').padEnd(11).substring(0, 11);
      
      console.log(`│ ${name} │ ${reservedIp} │ ${baseDomain} │ ${region} │ ${activeNode} │`);
    }
    
    console.log('└─────────────────┴──────────────────┴─────────────────┴──────────────┴─────────────┘');
    
    // Show additional details
    console.log('\nFor more details, use:');
    console.log('  dynia cluster node list <cluster-name>  # Show cluster nodes');
    console.log('  dynia cluster routes list <cluster-name> # Show cluster routes (when implemented)');
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
  }
}