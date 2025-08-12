import { BaseCommand } from '../../shared/base/base-command.js';
import { NodeNameSchema, ValidationUtils } from '../../shared/utils/validation.js';
import { InfrastructureChecker } from '../../shared/utils/infrastructure-checker.js';
import { DockerInfrastructure } from '../../shared/utils/docker-infrastructure.js';
import { createCloudflareProvider } from '../../core/providers/cloudflare-provider.js';
import { Helpers } from '../../shared/utils/helpers.js';
import type { Node } from '../../shared/types/index.js';

/**
 * Options for node repair command
 */
export interface NodeRepairOptions {
  name: string;
  force?: boolean;
  checkOnly?: boolean;
}

/**
 * Command to repair and recover failed node infrastructure
 * Stateless recovery that checks current state and fixes what's missing
 */
export class NodeRepairCommand extends BaseCommand<NodeRepairOptions> {
  protected async run(): Promise<void> {
    const { name, force = false, checkOnly = false } = this.argv;

    // Validate inputs
    ValidationUtils.validateRequiredArgs(this.argv, ['name']);
    NodeNameSchema.parse(name);

    this.logger.info(`${checkOnly ? 'Checking' : 'Repairing'} node: ${name}`);

    // Get node from state
    const existingNodes = await this.stateManager.getNodes();
    const node = existingNodes.find(n => n.name === name);
    
    if (!node) {
      throw new Error(`Node '${name}' not found in state. Use 'dynia node create' first.`);
    }

    // Check current infrastructure state
    const checker = new InfrastructureChecker(
      {
        nodeName: node.name,
        nodeIp: node.ip,
        domain: this.config.public.cloudflare.domain,
        healthPath: node.healthPath
      },
      this.logger
    );

    const state = await checker.checkInfrastructure();

    // Display current state
    this.displayInfrastructureState(state);

    if (checkOnly) {
      return; // Just check, don't repair
    }

    if (!state.sshConnectable) {
      throw new Error(
        `Cannot connect to node ${name} via SSH at ${node.ip}. ` +
        'Check if the VM is running and SSH key is configured correctly.'
      );
    }

    // Determine what needs repair
    const repairPlan = this.createRepairPlan(state, node);
    
    if (repairPlan.length === 0) {
      this.logger.info(`✅ Node ${name} infrastructure is healthy - no repairs needed`);
      return;
    }

    // Show repair plan
    this.logger.info(`\nRepair plan for ${name}:`);
    repairPlan.forEach((action, index) => {
      this.logger.info(`  ${index + 1}. ${action.description}`);
    });

    if (!force && !this.dryRun) {
      this.logger.info('\nUse --force to execute repairs, or --check-only to just check status');
      return;
    }

    // Execute repairs
    await this.executeRepairs(repairPlan, node);

    // Re-check after repairs
    const finalState = await checker.checkInfrastructure();
    this.displayInfrastructureState(finalState, 'Final State');

    if (finalState.errors.length === 0) {
      this.logger.info(`✅ Node ${name} repair completed successfully`);
      
      // Update node status to active if all checks pass
      await this.updateNodeStatusToActive(node);
    } else {
      this.logger.info(`⚠️  Node ${name} repair completed with some issues:`);
      finalState.errors.forEach(error => {
        this.logger.info(`   - ${error}`);
      });
    }
  }

  /**
   * Display infrastructure state in a readable format
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private displayInfrastructureState(state: any, title: string = 'Infrastructure State'): void {
    this.logger.info(`\n${title}:`);
    this.logger.info(`  SSH Connectable: ${state.sshConnectable ? '✅' : '❌'}`);
    this.logger.info(`  Docker Installed: ${state.dockerInstalled ? '✅' : '❌'}`);
    this.logger.info(`  Edge Network: ${state.edgeNetworkExists ? '✅' : '❌'}`);
    this.logger.info(`  Caddy Running: ${state.caddyRunning ? '✅' : '❌'}`);
    this.logger.info(`  Placeholder Running: ${state.placeholderRunning ? '✅' : '❌'}`);
    this.logger.info(`  HTTPS Accessible: ${state.httpsAccessible ? '✅' : '❌'}`);
    
    if (state.errors.length > 0) {
      this.logger.info(`\nIssues found:`);
      state.errors.forEach((error: string) => {
        this.logger.info(`  ❌ ${error}`);
      });
    }
  }

  /**
   * Create a repair plan based on the current state
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  private createRepairPlan(state: any, _node: Node): Array<{ type: string; description: string }> {
    const plan: Array<{ type: string; description: string }> = [];

    if (!state.dockerInstalled) {
      plan.push({
        type: 'install-docker',
        description: 'Install Docker and Docker Compose'
      });
    }

    if (state.dockerInstalled && !state.edgeNetworkExists) {
      plan.push({
        type: 'create-network',
        description: 'Create Docker edge network'
      });
    }

    if (state.dockerInstalled && !state.caddyRunning) {
      plan.push({
        type: 'deploy-caddy',
        description: 'Deploy and start Caddy service'
      });
    }

    if (state.dockerInstalled && !state.placeholderRunning) {
      plan.push({
        type: 'deploy-placeholder',
        description: 'Deploy and start placeholder service'
      });
    }

    if (!state.httpsAccessible && state.caddyRunning) {
      plan.push({
        type: 'check-dns',
        description: 'Verify DNS propagation and certificate generation'
      });
    }

    return plan;
  }

  /**
   * Execute the repair plan with retry logic and continue through failures
   */
  private async executeRepairs(
    repairPlan: Array<{ type: string; description: string }>, 
    node: Node
  ): Promise<void> {
    const infrastructure = new DockerInfrastructure(
      node.ip,
      node.name,
      this.config.public.cloudflare.domain,
      this.logger
    );

    const failedActions: Array<{ action: typeof repairPlan[0]; error: Error }> = [];

    for (const action of repairPlan) {
      this.logger.info(`\nExecuting: ${action.description}`);
      
      if (this.dryRun) {
        this.logDryRun(action.description);
        continue;
      }

      try {
        // Execute each repair step with retry logic
        await Helpers.retry(
          async () => {
            switch (action.type) {
              case 'install-docker':
                await infrastructure.installDocker();
                break;
              
              case 'create-network':
                await infrastructure.createEdgeNetwork();
                break;
              
              case 'deploy-caddy':
                await infrastructure.deployCaddy();
                break;
              
              case 'deploy-placeholder':
                await infrastructure.deployPlaceholder();
                break;
              
              case 'check-dns':
                await this.verifyDNSAndCertificates(node);
                break;
              
              default:
                this.logger.warn(`Unknown repair action: ${action.type}`);
            }
          },
          {
            maxAttempts: action.type === 'install-docker' ? 3 : 2,
            baseDelay: action.type === 'install-docker' ? 10000 : 5000,
            maxDelay: action.type === 'install-docker' ? 60000 : 30000,
            description: action.description
          }
        );
        
        this.logger.info(`✅ ${action.description} completed`);
        
      } catch (error) {
        this.logger.error(`❌ ${action.description} failed after retries: ${error}`);
        failedActions.push({ action, error: error as Error });
        // Continue with next action instead of stopping
      }
    }

    // Report summary of failures if any
    if (failedActions.length > 0) {
      this.logger.warn(`\n⚠️  Some repair actions failed:`);
      failedActions.forEach(({ action, error }) => {
        this.logger.warn(`   - ${action.description}: ${error.message}`);
      });
      
      // Only throw if critical actions failed (Docker installation)
      const criticalFailures = failedActions.filter(f => f.action.type === 'install-docker');
      if (criticalFailures.length > 0) {
        throw new Error(`Critical repair failures: ${criticalFailures.map(f => f.action.description).join(', ')}`);
      }
    }
  }

  /**
   * Update node status to active after successful health check
   */
  private async updateNodeStatusToActive(node: Node): Promise<void> {
    const updatedNode: Node = {
      ...node,
      status: 'active'
    };

    await this.stateManager.upsertNode(updatedNode);
    this.logger.info(`💾 Node status updated to: active`);
  }

  /**
   * Verify DNS propagation and certificate generation
   */
  private async verifyDNSAndCertificates(node: Node): Promise<void> {
    // Check DNS propagation
    const cfProvider = createCloudflareProvider(
      this.config.secrets.cloudflareToken,
      this.config.secrets.cloudflareZoneId,
      this.logger
    );

    const fqdn = `${node.name}.${this.config.public.cloudflare.domain}`;
    
    try {
      await cfProvider.waitForDnsPropagation(fqdn, node.ip);
      this.logger.info(`✅ DNS propagation verified for ${fqdn}`);
    } catch (error) {
      this.logger.warn(`DNS propagation issue for ${fqdn}: ${error}`);
    }

    // Wait a bit for certificate generation
    this.logger.info('Waiting for certificate generation...');
    await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
    
    if (!this.config.secrets.digitalOceanToken) {
      throw new Error('DYNIA_DO_TOKEN environment variable is required');
    }
    
    if (!this.config.secrets.cloudflareToken) {
      throw new Error('DYNIA_CF_TOKEN environment variable is required');
    }
    
    if (!this.config.secrets.cloudflareZoneId) {
      throw new Error('DYNIA_CF_ZONE_ID environment variable is required');
    }

    if (!this.config.secrets.sshKeyId) {
      throw new Error('DYNIA_SSH_KEY_ID environment variable is required');
    }
  }
}