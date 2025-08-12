import { BaseCommand } from '../../shared/base/base-command.js';
import { ValidationUtils } from '../../shared/utils/validation.js';
import { createDigitalOceanProvider } from '../../core/providers/digitalocean-provider.js';
import type { ClusterNode } from '../../shared/types/index.js';
import * as readline from 'readline';

export interface ClusterNodeRemoveOptions {
  'cluster-name': string;
  'node-id': string;
  confirm?: boolean;
}

/**
 * Command to remove a node from a cluster
 * Implements safe node removal with proper failover handling
 */
export class ClusterNodeRemoveCommand extends BaseCommand<ClusterNodeRemoveOptions> {
  protected async run(): Promise<void> {
    const { 'cluster-name': clusterName, 'node-id': nodeId, confirm = false } = this.argv;

    // Validate inputs
    ValidationUtils.validateRequiredArgs(this.argv, ['cluster-name', 'node-id']);

    this.logger.info(`Removing node ${nodeId} from cluster ${clusterName}...`);

    // Get cluster
    const cluster = await this.stateManager.getCluster(clusterName);
    if (!cluster) {
      throw new Error(`Cluster '${clusterName}' not found. Use 'dynia cluster create-ha' to create it first.`);
    }

    // Get target node
    const targetNode = await this.stateManager.getClusterNode(clusterName, nodeId);
    if (!targetNode) {
      throw new Error(`Node '${nodeId}' not found in cluster '${clusterName}'.`);
    }

    // Get all cluster nodes to check constraints
    const allNodes = await this.stateManager.getClusterNodes(clusterName);
    
    // Safety check: Cannot remove the last node
    if (allNodes.length === 1) {
      throw new Error(
        `Cannot remove the last node from cluster '${clusterName}'. ` +
        'Destroy the entire cluster with: dynia cluster destroy ' + clusterName
      );
    }

    // If removing active node, we need a replacement
    const isActiveNode = targetNode.role === 'active';
    let replacementNode: ClusterNode | null = null;
    
    if (isActiveNode) {
      // Find the standby node with highest priority to promote
      const standbyNodes = allNodes.filter(n => n.role === 'standby' && n.twoWordId !== nodeId);
      if (standbyNodes.length === 0) {
        throw new Error(`Cannot remove active node '${nodeId}' - no standby nodes available for failover.`);
      }
      
      replacementNode = standbyNodes.sort((a, b) => b.priority - a.priority)[0];
      
      this.logger.info(`⚠️  Removing active node '${nodeId}'. Will promote '${replacementNode.twoWordId}' to active.`);
    }

    // Confirmation prompt (unless dry-run or --confirm)
    if (!this.dryRun && !confirm) {
      const shouldContinue = await this.promptConfirmation(
        targetNode, 
        replacementNode, 
        isActiveNode
      );
      
      if (!shouldContinue) {
        this.logger.info('❌ Node removal cancelled by user.');
        return;
      }
    }

    // Step 1: If removing active node, perform failover first
    if (isActiveNode && replacementNode) {
      await this.performFailover(cluster.reservedIpId, replacementNode, clusterName);
    }

    // Step 2: Remove the droplet
    await this.removeDroplet(targetNode);

    // Step 3: Update cluster state
    await this.removeNodeFromState(clusterName, nodeId);

    // Success summary
    this.logger.info(`\n✅ Node ${nodeId} has been removed from cluster ${clusterName}`);
    
    if (replacementNode) {
      this.logger.info(`   New active node: ${replacementNode.twoWordId} (${replacementNode.publicIp})`);
    }
    
    this.logger.info(`   Remaining nodes: ${allNodes.length - 1}`);
    
    this.logger.info('\nNext steps:');
    this.logger.info(`   1. Check cluster status: dynia cluster node list ${clusterName}`);
    this.logger.info(`   2. Verify connectivity: curl https://your-domain.com`);
    this.logger.info(`   3. Consider adding more nodes: dynia cluster node add --name ${clusterName}`);
  }

  /**
   * Prompt user for confirmation before removing node
   */
  private async promptConfirmation(
    targetNode: ClusterNode, 
    replacementNode: ClusterNode | null, 
    isActiveNode: boolean
  ): Promise<boolean> {
    console.log('\n⚠️  You are about to remove a cluster node:');
    console.log(`   Node: ${targetNode.twoWordId} (${targetNode.publicIp})`);
    console.log(`   Role: ${targetNode.role}`);
    console.log(`   Status: ${targetNode.status}`);
    
    if (isActiveNode && replacementNode) {
      console.log(`\n🔄 This will trigger a failover:`);
      console.log(`   Reserved IP will move to: ${replacementNode.twoWordId} (${replacementNode.publicIp})`);
      console.log(`   Services may experience brief downtime during failover`);
    }
    
    console.log(`\n💥 The droplet will be permanently destroyed!`);
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question('\nDo you want to continue? (yes/no): ', (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
      });
    });
  }

  /**
   * Perform failover to replacement node before removing active node
   */
  private async performFailover(
    reservedIpId: string, 
    replacementNode: ClusterNode, 
    clusterName: string
  ): Promise<void> {
    this.logger.info(`Performing failover to node ${replacementNode.twoWordId}...`);
    
    if (this.dryRun) {
      this.logDryRun(`reassign Reserved IP to node ${replacementNode.twoWordId}`);
      this.logDryRun(`update node ${replacementNode.twoWordId} role to active`);
      return;
    }

    const doProvider = createDigitalOceanProvider(
      this.config.secrets.digitalOceanToken,
      this.logger
    );

    try {
      // Reassign Reserved IP to replacement node
      await doProvider.assignReservedIp(reservedIpId, replacementNode.dropletId);
      
      this.logger.info(`✅ Reserved IP reassigned to ${replacementNode.twoWordId}`);
      
      // Wait for Reserved IP reassignment to propagate
      this.logger.info('Waiting for Reserved IP propagation...');
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      // Update replacement node to active in state
      const updatedReplacementNode: ClusterNode = {
        ...replacementNode,
        role: 'active',
      };
      
      await this.stateManager.upsertClusterNode(updatedReplacementNode);
      
      // Update cluster's active node reference
      const cluster = await this.stateManager.getCluster(clusterName);
      if (cluster) {
        const updatedCluster = {
          ...cluster,
          activeNodeId: replacementNode.twoWordId,
        };
        await this.stateManager.upsertCluster(updatedCluster);
      }
      
      this.logger.info(`✅ Node ${replacementNode.twoWordId} promoted to active`);
      
    } catch (error) {
      this.logger.error(`❌ Failover failed: ${error}`);
      throw new Error(`Cannot proceed with node removal - failover failed. Cluster may need manual repair.`);
    }
  }

  /**
   * Remove the droplet from DigitalOcean
   */
  private async removeDroplet(node: ClusterNode): Promise<void> {
    this.logger.info(`Destroying droplet for node ${node.twoWordId}...`);
    
    if (this.dryRun) {
      this.logDryRun(`destroy droplet ${node.dropletId} (${node.hostname})`);
      return;
    }

    const doProvider = createDigitalOceanProvider(
      this.config.secrets.digitalOceanToken,
      this.logger
    );

    try {
      await doProvider.deleteDroplet(node.dropletId);
      this.logger.info(`✅ Droplet ${node.hostname} destroyed`);
      
    } catch (error) {
      this.logger.error(`❌ Failed to destroy droplet: ${error}`);
      // Don't throw here - we still want to clean up state even if droplet deletion fails
      this.logger.info('Continuing with state cleanup despite droplet deletion failure...');
    }
  }

  /**
   * Remove node from cluster state
   */
  private async removeNodeFromState(clusterName: string, nodeId: string): Promise<void> {
    this.logger.info(`Removing node ${nodeId} from cluster state...`);
    
    if (this.dryRun) {
      this.logDryRun(`remove node ${nodeId} from cluster ${clusterName} state`);
      return;
    }

    try {
      const removed = await this.stateManager.removeClusterNode(clusterName, nodeId);
      if (removed) {
        this.logger.info(`✅ Node ${nodeId} removed from cluster state`);
      } else {
        this.logger.warn(`⚠️  Node ${nodeId} was not found in cluster state (may have already been removed)`);
      }
      
    } catch (error) {
      this.logger.error(`❌ Failed to remove node from state: ${error}`);
      throw new Error(`State cleanup failed. Manual state repair may be required.`);
    }
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
    
    if (!this.config.secrets.digitalOceanToken) {
      throw new Error('DYNIA_DO_TOKEN environment variable is required');
    }
  }
}