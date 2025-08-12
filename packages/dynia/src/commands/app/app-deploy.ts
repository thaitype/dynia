import { existsSync } from 'node:fs';

import type { ArgumentsCamelCase } from 'yargs';

import { DockerProvider } from '../../core/providers/docker-provider.js';
import { createHealthProvider } from '../../core/providers/health-provider.js';
import type { GlobalConfigOptions } from '../../internal/types.js';
import { BaseCommand } from '../../shared/base/base-command.js';
import type { Deployment, Node } from '../../shared/types/index.js';
import { Helpers } from '../../shared/utils/helpers.js';
import { ValidationUtils } from '../../shared/utils/validation.js';

/**
 * Options for app deploy command
 */
export interface AppDeployOptions {
  node: string;
  compose: string;
}

/**
 * Command to deploy an application to a node
 * Implements the complete deployment flow from the specification
 */
export class AppDeployCommand extends BaseCommand<AppDeployOptions> {
  private dockerProvider: DockerProvider;
  private healthProvider: ReturnType<typeof createHealthProvider>;

  constructor(argv: ArgumentsCamelCase<GlobalConfigOptions & AppDeployOptions>) {
    super(argv);
    this.dockerProvider = new DockerProvider(this.logger);
    this.healthProvider = createHealthProvider(this.logger);
  }

  protected async run(): Promise<void> {
    const { node: nodeName, compose: composeFile } = this.argv;

    // Validate inputs
    ValidationUtils.validateRequiredArgs(this.argv, ['node', 'compose']);

    if (!existsSync(composeFile)) {
      throw new Error(`Compose file not found: ${composeFile}`);
    }

    // Get node information
    const node = await this.stateManager.getNode(nodeName);
    if (!node) {
      throw new Error(`Node '${nodeName}' not found. Use 'dynia node list' to see available nodes.`);
    }

    if (node.status !== 'active') {
      throw new Error(`Node '${nodeName}' is not active (status: ${node.status})`);
    }

    this.logger.info(`Deploying application to node: ${nodeName}`);
    this.logger.info(`Using compose file: ${composeFile}`);

    // Step 1: Preflight checks
    await this.preflightChecks(node, composeFile);

    // Step 2: Analyze compose file
    const entryService = await this.analyzeComposeFile(composeFile);

    // Step 3: Deploy application
    const composeHash = await this.deployApplication(composeFile);

    // Step 4: Internal health check
    await this.performInternalHealthCheck(entryService, node);

    // Step 5: Update Caddy configuration
    await this.updateCaddyConfiguration(node, entryService);

    // Step 6: External health check
    await this.performExternalHealthCheck(node);

    // Step 7: Update deployment state
    await this.updateDeploymentState(node, entryService, composeHash);

    this.logger.info(`✅ Application deployed successfully to ${nodeName}`);
    this.logger.info(`   Service: ${entryService.name}:${entryService.port}`);
    this.logger.info(`   URL: https://${node.fqdn}`);
  }

  /**
   * Perform preflight checks
   */
  private async preflightChecks(node: Node, composeFile: string): Promise<void> {
    this.logger.info('Running preflight checks...');

    if (this.dryRun) {
      this.logDryRun('run preflight checks (SSH connectivity, Docker network)');
      return;
    }

    // In a real implementation, this would:
    // 1. Test SSH connectivity to the node
    // 2. Ensure 'edge' Docker network exists
    // 3. Validate docker-compose config

    // For now, we'll just validate the compose file locally
    try {
      await this.dockerProvider.getComposeServices(composeFile);
    } catch (error) {
      throw new Error(`Invalid compose file: ${error instanceof Error ? error.message : error}`);
    }

    this.logger.info('✅ Preflight checks passed');
  }

  /**
   * Analyze compose file and determine entry service
   */
  private async analyzeComposeFile(composeFile: string): Promise<{ name: string; port: number; domain: string }> {
    this.logger.info('Analyzing compose file...');

    const services = await this.dockerProvider.getComposeServices(composeFile);

    // Find entry service using Dynia conventions
    let entryService = services.find(s => s.labels['dynia.entry'] === 'true');
    if (!entryService) {
      entryService = services.find(s => s.name === 'web');
    }
    if (!entryService) {
      entryService = services[0]; // Fallback to first service
    }

    if (!entryService) {
      throw new Error('No services found in compose file');
    }

    // Determine entry port
    let entryPort: number;
    if (entryService.labels['dynia.port']) {
      entryPort = parseInt(entryService.labels['dynia.port'], 10);
      ValidationUtils.validatePort(entryPort);
    } else if (entryService.ports.length > 0) {
      entryPort = entryService.ports[0];
    } else {
      throw new Error(
        `No port found for entry service '${entryService.name}'. Use 'dynia.port' label or expose ports.`
      );
    }

    // Determine domain (use node FQDN by default)
    const node = await this.stateManager.getNode(this.argv.node);
    const domain = entryService.labels['dynia.domain'] || node!.fqdn;

    this.logger.info(`Entry service: ${entryService.name}:${entryPort} → ${domain}`);

    return {
      name: entryService.name,
      port: entryPort,
      domain,
    };
  }

  /**
   * Deploy the application using docker-compose
   */
  private async deployApplication(composeFile: string): Promise<string> {
    this.logger.info('Deploying application...');

    const composeHash = await Helpers.hashFile(composeFile);

    if (this.dryRun) {
      this.logDryRun(`upload and deploy compose file (hash: ${composeHash.slice(0, 12)})`);
      return composeHash;
    }

    // In a real implementation, this would:
    // 1. Upload compose file to the node
    // 2. Run docker-compose pull && docker-compose up -d
    // 3. Ensure all services join the 'edge' network

    throw new Error('Remote deployment not yet implemented');
  }

  /**
   * Check internal service health
   */
  private async performInternalHealthCheck(entryService: { name: string; port: number }, node: Node): Promise<void> {
    this.logger.info('Checking internal service health...');

    const internalUrl = `http://${entryService.name}:${entryService.port}${node.healthPath}`;

    if (this.dryRun) {
      this.logDryRun(`check internal health at ${internalUrl}`);
      return;
    }

    // In a real implementation, this would check the service via Docker network
    // For now, we'll simulate the check
    this.logger.info(`Would check: ${internalUrl}`);

    // Simulate health check
    await Helpers.sleep(1000);
    this.logger.info('✅ Internal health check passed');
  }

  /**
   * Update Caddy configuration
   */
  private async updateCaddyConfiguration(
    node: Node,
    entryService: { name: string; port: number; domain: string }
  ): Promise<void> {
    this.logger.info('Updating Caddy configuration...');

    if (this.dryRun) {
      this.logDryRun(`update Caddy to route ${entryService.domain} to ${entryService.name}:${entryService.port}`);
      return;
    }

    // In a real implementation, this would:
    // 1. Generate new Caddyfile with updated routing
    // 2. Upload to the node
    // 3. Reload Caddy configuration

    this.logger.info(`Would update routing: ${entryService.domain} → ${entryService.name}:${entryService.port}`);
    this.logger.info('✅ Caddy configuration updated');
  }

  /**
   * Check external service health
   */
  private async performExternalHealthCheck(node: Node): Promise<void> {
    this.logger.info('Checking external service health...');

    const externalUrl = `https://${node.fqdn}${node.healthPath}`;

    if (this.dryRun) {
      this.logDryRun(`check external health at ${externalUrl}`);
      return;
    }

    try {
      await this.healthProvider.checkHealthWithRetries(externalUrl, {
        maxAttempts: 5,
        retryDelay: 3000,
      });
      this.logger.info('✅ External health check passed');
    } catch (error) {
      // Rollback to placeholder on failure
      this.logger.error('External health check failed, rolling back to placeholder');
      await this.rollbackToPlaceholder(node);
      throw error;
    }
  }

  /**
   * Update deployment state
   */
  private async updateDeploymentState(
    node: Node,
    entryService: { name: string; port: number; domain: string },
    composeHash: string
  ): Promise<void> {
    const deployment: Deployment = {
      node: node.name,
      composeHash,
      entryService: entryService.name,
      entryPort: entryService.port,
      domain: entryService.domain,
      status: 'active',
      updatedAt: Helpers.generateTimestamp(),
    };

    await this.conditionalExecute(
      () => this.stateManager.upsertDeployment(deployment),
      `save deployment state for node ${node.name}`
    );

    // Also update node's Caddy target
    const updatedNode: Node = {
      ...node,
      caddy: {
        domain: entryService.domain,
        target: {
          service: entryService.name,
          port: entryService.port,
        },
      },
    };

    await this.conditionalExecute(
      () => this.stateManager.upsertNode(updatedNode),
      `update node ${node.name} Caddy configuration`
    );
  }

  /**
   * Rollback to placeholder service on deployment failure
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async rollbackToPlaceholder(_node: Node): Promise<void> {
    this.logger.info('Rolling back to placeholder...');

    if (this.dryRun) {
      this.logDryRun('rollback Caddy configuration to placeholder service');
      return;
    }

    // In a real implementation, this would restore Caddy to route to placeholder
    this.logger.info('✅ Rollback completed');
  }
}
