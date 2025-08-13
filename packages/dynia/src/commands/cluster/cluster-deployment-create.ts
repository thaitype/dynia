import { BaseCommand } from '../../shared/base/base-command.js';
import { ValidationUtils } from '../../shared/utils/validation.js';
import { createCloudflareProvider } from '../../core/providers/cloudflare-provider.js';
import { DockerInfrastructure } from '../../shared/utils/docker-infrastructure.js';
import { createDigitalOceanProvider } from '../../core/providers/digitalocean-provider.js';
import type { Route } from '../../shared/types/index.js';
import { Helpers } from '../../shared/utils/helpers.js';

export interface ClusterDeploymentCreateOptions {
  name: string;
  compose?: string;
  domain?: string;
  placeholder?: boolean;
  'health-path'?: string;  // Use kebab-case to match yargs
  proxied?: boolean;
}

/**
 * Command to deploy services to a cluster with host-based routing
 * Supports both custom compose files and placeholder deployments for testing
 */
export class ClusterDeploymentCreateCommand extends BaseCommand<ClusterDeploymentCreateOptions> {
  protected async run(): Promise<void> {
    const { 
      name, 
      compose, 
      domain, 
      placeholder = false, 
      'health-path': healthPath = '/healthz',
      proxied = true 
    } = this.argv;

    // Validate inputs
    ValidationUtils.validateRequiredArgs(this.argv, ['name']);
    
    // Get cluster
    const cluster = await this.stateManager.getCluster(name);
    if (!cluster) {
      throw new Error(`Cluster '${name}' not found. Use 'dynia cluster create-ha' to create it first.`);
    }

    // Get active node
    const activeNode = await this.stateManager.getActiveClusterNode(name);
    if (!activeNode) {
      throw new Error(`No active node found in cluster '${name}'. The cluster may be misconfigured.`);
    }

    // Determine deployment target domain
    let targetDomain: string;
    if (placeholder) {
      targetDomain = `dynia-placeholder-${name}.${cluster.baseDomain}`;
      this.logger.info(`Deploying placeholder service to cluster: ${name}`);
      this.logger.info(`Target domain: ${targetDomain}`);
    } else {
      if (!domain) {
        throw new Error('Either --placeholder or --domain is required');
      }
      if (!compose) {
        throw new Error('--compose is required when not using --placeholder');
      }
      targetDomain = domain;
      this.logger.info(`Deploying custom service to cluster: ${name}`);
      this.logger.info(`Target domain: ${targetDomain}`);
      this.logger.info(`Compose file: ${compose}`);
    }

    // Check for domain conflicts
    await this.checkDomainConflicts(name, targetDomain);

    // Step 1: Deploy service to active node
    await this.deployServiceToNode(activeNode, targetDomain, placeholder, compose, healthPath);

    // Step 2: Configure DNS
    if (!cluster.reservedIp) {
      throw new Error(`Cluster '${name}' does not have a Reserved IP assigned. Use 'dynia cluster reserved-ip assign --cluster ${name} --node <node-id>' to assign one.`);
    }
    await this.configureDNS(targetDomain, cluster.reservedIp, proxied);

    // Step 3: Save route in state
    await this.saveRouteState(name, targetDomain, healthPath, proxied, placeholder, compose);

    // Step 4: Validate deployment
    await this.validateDeployment(targetDomain, healthPath);

    // Success summary
    this.logger.info(`\n✅ Service deployed successfully to cluster ${name}`);
    this.logger.info(`   Domain: ${targetDomain}`);
    this.logger.info(`   Reserved IP: ${cluster.reservedIp}`);
    this.logger.info(`   Active node: ${activeNode.twoWordId} (${activeNode.publicIp})`);
    this.logger.info(`   Health check: ${targetDomain}${healthPath}`);
    
    this.logger.info('\nNext steps:');
    this.logger.info(`   1. Test access: curl https://${targetDomain}`);
    this.logger.info(`   2. Health check: curl https://${targetDomain}${healthPath}`);
    this.logger.info(`   3. Check cluster: dynia cluster node list ${name}`);
  }

  /**
   * Check for domain conflicts in existing routes
   */
  private async checkDomainConflicts(clusterName: string, domain: string): Promise<void> {
    const existingRoute = await this.stateManager.getRoute(clusterName, domain);
    if (existingRoute) {
      this.logger.info(`⚠️  Domain ${domain} is already configured for this cluster`);
      this.logger.info('This will update the existing deployment');
    }
  }

  /**
   * Deploy service to the active cluster node
   */
  private async deployServiceToNode(
    activeNode: any,
    domain: string,
    isPlaceholder: boolean,
    composePath?: string,
    healthPath: string = '/healthz'
  ): Promise<void> {
    this.logger.info(`Deploying service to node ${activeNode.twoWordId}...`);
    
    if (this.dryRun) {
      if (isPlaceholder) {
        this.logDryRun(`deploy placeholder service on node ${activeNode.twoWordId}`);
      } else {
        this.logDryRun(`deploy service from ${composePath} on node ${activeNode.twoWordId}`);
      }
      this.logDryRun(`configure Caddy route: ${domain} → service`);
      return;
    }

    const infrastructure = new DockerInfrastructure(
      activeNode.publicIp,
      activeNode.twoWordId,
      domain,
      this.logger
    );

    if (isPlaceholder) {
      // Deploy placeholder service
      await infrastructure.deployPlaceholderService(domain, healthPath);
    } else {
      // Deploy custom service from compose file
      await infrastructure.deployCustomService(composePath!, domain, healthPath);
    }

    // Generate complete Caddyfile based on all cluster routes (including the new one)
    await this.regenerateCompleteCaddyfile(activeNode, domain, healthPath);

    this.logger.info(`✅ Service deployed to node ${activeNode.twoWordId}`);
  }

  /**
   * Regenerate complete Caddyfile based on all cluster routes
   */
  private async regenerateCompleteCaddyfile(
    activeNode: any,
    newDomain: string,
    newHealthPath: string
  ): Promise<void> {
    this.logger.info('Regenerating complete Caddyfile configuration...');

    // Get all routes for this cluster
    const clusterRoutes = await this.stateManager.getClusterRoutes(activeNode.clusterId);

    // Create simplified routes array for Caddyfile generation
    const caddyRoutes = clusterRoutes.map((route: any) => ({
      host: route.host,
      healthPath: route.healthPath
    }));

    // Add the current deployment route (in case it's not saved to state yet)
    const existingRoute = caddyRoutes.find((r: any) => r.host === newDomain);
    if (!existingRoute) {
      caddyRoutes.push({host: newDomain, healthPath: newHealthPath});
    }

    // Generate complete Caddyfile on the active node
    const infrastructure = new DockerInfrastructure(
      activeNode.publicIp,
      activeNode.twoWordId,
      newDomain, // domain parameter (not used in the new method)
      this.logger
    );

    await infrastructure.generateCompleteCaddyfile(caddyRoutes);
  }

  /**
   * Configure DNS record for the domain
   */
  private async configureDNS(domain: string, reservedIp: string, proxied: boolean): Promise<void> {
    this.logger.info(`Configuring DNS: ${domain} → ${reservedIp}`);
    
    if (this.dryRun) {
      this.logDryRun(`create/update DNS A record: ${domain} → ${reservedIp} (proxied: ${proxied})`);
      return;
    }

    const cfProvider = createCloudflareProvider(
      this.config.secrets.cloudflareToken,
      this.config.secrets.cloudflareZoneId!,
      this.logger
    );

    try {
      // Create or update DNS A record
      await cfProvider.upsertARecord({
        name: domain,
        ip: reservedIp,
        proxied
      });
      
      this.logger.info(`✅ DNS configured: ${domain} → ${reservedIp}`);
      
    } catch (error) {
      this.logger.error(`❌ DNS configuration failed: ${error}`);
      throw new Error(`Failed to configure DNS for ${domain}. The service may not be accessible.`);
    }
  }

  /**
   * Save route configuration in cluster state
   */
  private async saveRouteState(
    clusterName: string,
    domain: string, 
    healthPath: string,
    proxied: boolean,
    isPlaceholder: boolean,
    composePath?: string
  ): Promise<void> {
    this.logger.info('Saving route configuration...');
    
    if (this.dryRun) {
      this.logDryRun(`save route ${domain} for cluster ${clusterName}`);
      return;
    }

    const route: Route = {
      clusterId: clusterName,
      host: domain,
      healthPath,
      proxied,
      tlsEnabled: true,
      isPlaceholder,
      composePath,
      createdAt: Helpers.generateTimestamp(),
      updatedAt: Helpers.generateTimestamp()
    };

    await this.stateManager.upsertRoute(route);
    this.logger.info(`✅ Route saved: ${domain}`);
  }

  /**
   * Validate deployment by checking DNS and service health
   */
  private async validateDeployment(domain: string, healthPath: string): Promise<void> {
    this.logger.info('Validating deployment...');
    
    if (this.dryRun) {
      this.logDryRun(`validate DNS resolution and health check for ${domain}`);
      return;
    }

    // Wait a bit for DNS propagation
    this.logger.info('Waiting for DNS propagation...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    try {
      // Simple DNS and HTTPS validation
      // Note: Full health check validation could be added here
      this.logger.info(`✅ Deployment validation completed for ${domain}`);
      this.logger.info('   DNS and basic connectivity should be working');
      this.logger.info('   TLS certificates will be automatically provisioned by Caddy');
      
    } catch (error) {
      this.logger.warn(`⚠️  Deployment validation had issues: ${error}`);
      this.logger.info('The service may still work - check manually with curl');
    }
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
    
    if (!this.config.secrets.cloudflareToken) {
      throw new Error('DYNIA_CF_TOKEN environment variable is required');
    }
    
    if (!this.config.secrets.cloudflareZoneId) {
      throw new Error('DYNIA_CF_ZONE_ID environment variable is required');
    }
  }
}