import { BaseCommand } from '../../shared/base/base-command.js';
import { ValidationUtils } from '../../shared/utils/validation.js';
import type { ClusterNode } from '../../shared/types/index.js';

export interface ClusterNodeListOptions {
  cluster: string;
}

/**
 * Command to list all nodes in a cluster
 * Shows detailed information about each node including role, status, and IPs
 */
export class ClusterNodeListCommand extends BaseCommand<ClusterNodeListOptions> {
  protected async run(): Promise<void> {
    const { cluster: clusterName } = this.argv;

    // Validate inputs
    ValidationUtils.validateRequiredArgs(this.argv, ['cluster']);

    this.logger.info(`Listing nodes in cluster: ${clusterName}`);

    // Get cluster
    const cluster = await this.stateManager.getCluster(clusterName);
    if (!cluster) {
      throw new Error(`Cluster '${clusterName}' not found. Use 'dynia cluster create-ha' to create it first.`);
    }

    // Get cluster nodes
    const nodes = await this.stateManager.getClusterNodes(clusterName);
    
    if (nodes.length === 0) {
      this.logger.info(`No nodes found in cluster '${clusterName}'.`);
      this.logger.info(`Add nodes with: dynia cluster node add --name ${clusterName}`);
      return;
    }

    // Display cluster summary
    const activeNode = nodes.find(n => n.role === 'active');
    const standbyNodes = nodes.filter(n => n.role === 'standby');
    
    this.logger.info(`\nCluster: ${clusterName}`);
    this.logger.info(`Reserved IP: ${cluster.reservedIp}`);
    this.logger.info(`Active Node: ${activeNode?.twoWordId || 'None'}`);
    this.logger.info(`Total Nodes: ${nodes.length}\n`);

    // Sort nodes by priority (highest first)
    const sortedNodes = [...nodes].sort((a, b) => b.priority - a.priority);

    // Display nodes in table format
    this.displayNodesTable(sortedNodes);

    // Show additional status information
    const healthyNodes = nodes.filter(n => n.status === 'active');
    const unhealthyNodes = nodes.filter(n => n.status !== 'active');

    if (unhealthyNodes.length > 0) {
      this.logger.info(`\n⚠️  ${unhealthyNodes.length} node${unhealthyNodes.length === 1 ? '' : 's'} may need attention:`);
      for (const node of unhealthyNodes) {
        this.logger.info(`   ${node.twoWordId}: ${node.status}`);
      }
      this.logger.info(`\nRun: dynia cluster repair-ha ${clusterName} --check-only`);
    }

    // Show helpful commands
    console.log('\nUseful commands:');
    console.log(`  dynia cluster node add --name ${clusterName}             # Add more nodes`);
    console.log(`  dynia cluster node activate ${clusterName} <node-id>     # Change active node`);
    console.log(`  dynia cluster deployment create --name ${clusterName} --placeholder # Deploy test service`);
    console.log(`  dynia cluster repair-ha ${clusterName}                   # Repair cluster issues`);
  }

  /**
   * Display nodes in a formatted table
   */
  private displayNodesTable(nodes: ClusterNode[]): void {
    // Calculate column widths
    const maxNodeIdWidth = Math.max(8, ...nodes.map(n => n.twoWordId.length));
    const maxPublicIpWidth = Math.max(9, ...nodes.map(n => n.publicIp.length));
    const maxPrivateIpWidth = Math.max(10, ...nodes.map(n => (n.privateIp || 'N/A').length));

    // Header
    const header = [
      '┌─'.padEnd(maxNodeIdWidth + 1, '─') + '─┬─',
      'Role'.padEnd(7, '─') + '─┬─',
      'Priority'.padEnd(8, '─') + '─┬─',
      'Public IP'.padEnd(maxPublicIpWidth, '─') + '─┬─',
      'Private IP'.padEnd(maxPrivateIpWidth, '─') + '─┬─',
      'Status'.padEnd(7, '─') + '─┐'
    ].join('');

    const titleRow = [
      '│ Node ID'.padEnd(maxNodeIdWidth + 1) + ' │',
      ' Role'.padEnd(7) + ' │',
      ' Priority'.padEnd(8) + ' │',
      ' Public IP'.padEnd(maxPublicIpWidth) + ' │',
      ' Private IP'.padEnd(maxPrivateIpWidth) + ' │',
      ' Status'.padEnd(7) + ' │'
    ].join('');

    const separator = [
      '├─'.padEnd(maxNodeIdWidth + 1, '─') + '─┼─',
      ''.padEnd(7, '─') + '─┼─',
      ''.padEnd(8, '─') + '─┼─',
      ''.padEnd(maxPublicIpWidth, '─') + '─┼─',
      ''.padEnd(maxPrivateIpWidth, '─') + '─┼─',
      ''.padEnd(7, '─') + '─┤'
    ].join('');

    console.log(header);
    console.log(titleRow);
    console.log(separator);

    // Data rows
    for (const node of nodes) {
      const role = node.role === 'active' ? '🟢 active' : '🔵 standby';
      const status = this.getStatusDisplay(node.status);
      const privateIp = node.privateIp || 'N/A';

      const row = [
        `│ ${node.twoWordId}`.padEnd(maxNodeIdWidth + 1) + ' │',
        ` ${role}`.padEnd(7) + ' │',
        ` ${node.priority}`.padEnd(8) + ' │',
        ` ${node.publicIp}`.padEnd(maxPublicIpWidth) + ' │',
        ` ${privateIp}`.padEnd(maxPrivateIpWidth) + ' │',
        ` ${status}`.padEnd(7) + ' │'
      ].join('');

      console.log(row);
    }

    // Footer
    const footer = [
      '└─'.padEnd(maxNodeIdWidth + 1, '─') + '─┴─',
      ''.padEnd(7, '─') + '─┴─',
      ''.padEnd(8, '─') + '─┴─',
      ''.padEnd(maxPublicIpWidth, '─') + '─┴─',
      ''.padEnd(maxPrivateIpWidth, '─') + '─┴─',
      ''.padEnd(7, '─') + '─┘'
    ].join('');

    console.log(footer);
  }

  /**
   * Get display-friendly status with emoji
   */
  private getStatusDisplay(status: string): string {
    switch (status) {
      case 'active':
        return '✅ up';
      case 'provisioning':
        return '🔄 setup';
      case 'failed':
        return '❌ failed';
      case 'inactive':
        return '⏸️  down';
      default:
        return '❓ unknown';
    }
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
  }
}