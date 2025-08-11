import type { ArgumentsCamelCase } from 'yargs';

import { BaseCommand } from '../../shared/base/base-command.js';
import { createHealthProvider } from '../../core/providers/health-provider.js';
import type { GlobalConfigOptions } from '../../internal/types.js';
import type { Node } from '../../shared/types/index.js';

/**
 * Command to synchronize load balancer origins
 */
export class SlbSyncCommand extends BaseCommand {
  private healthProvider: ReturnType<typeof createHealthProvider>;

  constructor(argv: ArgumentsCamelCase<GlobalConfigOptions>) {
    super(argv);
    this.healthProvider = createHealthProvider(this.logger);
  }

  protected async run(): Promise<void> {
    this.logger.info('Synchronizing load balancer origins...');

    // Step 1: Get all nodes
    const allNodes = await this.stateManager.getNodes();
    
    if (allNodes.length === 0) {
      this.logger.info('No nodes found. Nothing to sync.');
      return;
    }

    this.logger.info(`Found ${allNodes.length} node(s), checking health...`);

    // Step 2: Filter healthy nodes
    const healthyNodes = await this.filterHealthyNodes(allNodes);
    
    if (healthyNodes.length === 0) {
      this.logger.warn('No healthy nodes found!');
      return;
    }

    // Step 3: Build origins list
    const origins = healthyNodes.map(node => `https://${node.fqdn}`);
    
    this.logger.info(`Healthy nodes: ${healthyNodes.length}/${allNodes.length}`);
    for (const node of healthyNodes) {
      this.logger.info(`  ✅ ${node.name} (${node.fqdn})`);
    }

    const unhealthyNodes = allNodes.filter(node => 
      !healthyNodes.find(healthy => healthy.name === node.name)
    );
    
    if (unhealthyNodes.length > 0) {
      this.logger.warn('Unhealthy nodes:');
      for (const node of unhealthyNodes) {
        this.logger.warn(`  ❌ ${node.name} (${node.fqdn})`);
      }
    }

    // Step 4: Deploy to Cloudflare Workers
    await this.deployToWorker(origins);

    this.logger.info('✅ Load balancer synchronization completed');
    this.logger.info(`Origins: ${origins.join(', ')}`);
  }

  /**
   * Filter nodes by health status
   */
  private async filterHealthyNodes(nodes: Node[]): Promise<Node[]> {
    const healthyNodes: Node[] = [];

    for (const node of nodes) {
      if (node.status !== 'active') {
        this.logger.debug(`Skipping ${node.name}: status is ${node.status}`);
        continue;
      }

      const healthUrl = `https://${node.fqdn}${node.healthPath}`;
      
      try {
        const result = await this.healthProvider.checkHttp(healthUrl, {
          timeout: 10000,
        });

        if (result.healthy) {
          this.logger.debug(`Health check passed: ${node.name} (${result.responseTime}ms)`);
          healthyNodes.push(node);
        } else {
          this.logger.debug(`Health check failed: ${node.name} - ${result.error || `HTTP ${result.statusCode}`}`);
        }
      } catch (error) {
        this.logger.debug(`Health check error for ${node.name}: ${error instanceof Error ? error.message : error}`);
      }
    }

    return healthyNodes;
  }

  /**
   * Output origins list (simplified MVP approach)
   */
  private async deployToWorker(origins: string[]): Promise<void> {
    this.logger.info('Load balancer origins (configure your LB manually):');
    
    console.log('\n📋 Load Balancer Configuration:');
    console.log('================================');
    console.log(`Total healthy origins: ${origins.length}`);
    console.log('');
    console.log('Origins to add to your load balancer:');
    origins.forEach((origin, index) => {
      console.log(`  ${index + 1}. ${origin}`);
    });
    console.log('');
    console.log('💡 Configure these origins in your load balancer (Cloudflare, AWS ALB, nginx, etc.)');
    console.log('');

    if (this.dryRun) {
      this.logDryRun('output origins list for manual LB configuration');
      return;
    }

    this.logger.info('✅ Origins list generated successfully');
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
    
    if (!this.config.secrets.cloudflareToken) {
      throw new Error('DYNIA_CF_TOKEN environment variable is required for SLB sync');
    }
  }
}