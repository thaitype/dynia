import { BaseCommand } from '../../shared/base/base-command.js';
import { CertificateProvisioningService } from '../../shared/services/certificate-provisioning-service.js';
import { Table } from 'console-table-printer';

export interface ClusterCertificateOptions {
  domain?: string;
  'dry-run'?: boolean;
  verbose?: boolean;
  force?: boolean;
}

/**
 * Command to manage SSL certificates for cluster nodes
 * Handles Cloudflare Origin Certificates and fallback self-signed certificates
 */
export class ClusterCertificateCommand extends BaseCommand<ClusterCertificateOptions> {
  protected async run(): Promise<void> {
    const { name, domain: domainOverride, 'dry-run': dryRun = false, verbose = false, force = false } = this.argv;
    
    // Get the action from command line args (certificate is argv._[1], action is argv._[2])
    const action = String(this.argv._[2]) as 'provision' | 'status' | 'renew';
    const clusterName = name as string;
    
    if (!name) {
      throw new Error('Cluster name is required. Use --name <cluster-name>');
    }
    
    this.logger.info(`${dryRun ? '[DRY RUN] ' : ''}Managing certificates for cluster: ${clusterName}`);
    
    // Get cluster configuration
    const cluster = await this.stateManager.getCluster(clusterName);
    if (!cluster) {
      throw new Error(`Cluster '${clusterName}' not found. Use 'dynia cluster create-ha' to create it first.`);
    }
    
    // Get cluster nodes
    const allNodes = await this.stateManager.getClusterNodes(clusterName);
    if (allNodes.length === 0) {
      this.logger.info(`No nodes found in cluster '${clusterName}'.`);
      this.logger.info(`Add nodes with: dynia cluster node add --name ${clusterName}`);
      return;
    }
    
    // Determine domain - use override, cluster config, or derive from state
    const baseDomain = domainOverride || this.getClusterDomain(cluster);
    
    const certificateService = new CertificateProvisioningService(this.logger);
    
    switch (action) {
      case 'provision':
        await this.provisionCertificates(certificateService, baseDomain, clusterName, allNodes, { dryRun, verbose, force });
        break;
      case 'status':
        await this.checkCertificateStatus(certificateService, baseDomain, allNodes);
        break;
      case 'renew':
        await this.renewCertificates(certificateService, baseDomain, clusterName, allNodes, { dryRun, verbose });
        break;
      default:
        throw new Error(`Unknown action '${action}'. Use: provision, status, or renew`);
    }
  }
  
  /**
   * Provision certificates for all cluster nodes
   */
  private async provisionCertificates(
    service: CertificateProvisioningService,
    domain: string,
    clusterName: string,
    nodes: any[],
    options: { dryRun: boolean; verbose: boolean; force: boolean }
  ): Promise<void> {
    const { dryRun, verbose, force } = options;
    
    if (!force) {
      // Check if certificates already exist
      const statusResults = await service.checkCertificateStatus(domain, nodes);
      const hasValidCerts = statusResults.some(r => r.hasCertificate && r.isValid);
      
      if (hasValidCerts) {
        this.logger.info('Some nodes already have valid certificates. Use --force to re-provision.');
        this.displayCertificateStatus(statusResults, domain);
        return;
      }
    }
    
    this.logger.info(`${dryRun ? '[DRY RUN] ' : ''}Provisioning certificates for *.${domain}...`);
    
    const results = await service.provisionCertificates({
      domain,
      cluster: { name: clusterName, nodes },
      dryRun,
      verbose
    });
    
    this.displayCertificateStatus(results, domain);
    
    const successCount = results.filter(r => r.isValid).length;
    const totalCount = results.length;
    
    if (successCount === totalCount) {
      this.logger.info(`✅ Certificates provisioned successfully for all ${totalCount} node(s)`);
    } else {
      this.logger.warn(`⚠️ Certificates provisioned for ${successCount}/${totalCount} nodes. Check errors above.`);
    }
    
    if (!dryRun) {
      this.logger.info('\\nNext steps:');
      this.logger.info(`  1. Check certificate status: dynia cluster certificate status ${clusterName}`);
      this.logger.info(`  2. Test HTTPS connectivity: curl -I https://your-domain.${domain}`);
      this.logger.info(`  3. Restart HAProxy if needed: systemctl restart haproxy`);
    }
  }
  
  /**
   * Check certificate status for all cluster nodes
   */
  private async checkCertificateStatus(
    service: CertificateProvisioningService,
    domain: string,
    nodes: any[]
  ): Promise<void> {
    this.logger.info(`Checking certificate status for *.${domain}...`);
    
    const results = await service.checkCertificateStatus(domain, nodes);
    
    this.displayCertificateStatus(results, domain);
    
    const validCount = results.filter(r => r.isValid).length;
    const totalCount = results.length;
    
    if (validCount === totalCount) {
      this.logger.info(`✅ All ${totalCount} node(s) have valid certificates`);
    } else {
      this.logger.warn(`⚠️ ${totalCount - validCount} node(s) have certificate issues`);
    }
  }
  
  /**
   * Renew certificates for all cluster nodes
   */
  private async renewCertificates(
    service: CertificateProvisioningService,
    domain: string,
    clusterName: string,
    nodes: any[],
    options: { dryRun: boolean; verbose: boolean }
  ): Promise<void> {
    const { dryRun, verbose } = options;
    
    this.logger.info(`${dryRun ? '[DRY RUN] ' : ''}Renewing certificates for *.${domain}...`);
    
    const results = await service.provisionCertificates({
      domain,
      cluster: { name: clusterName, nodes },
      dryRun,
      verbose
    });
    
    this.displayCertificateStatus(results, domain);
    
    const successCount = results.filter(r => r.isValid).length;
    const totalCount = results.length;
    
    if (successCount === totalCount) {
      this.logger.info(`✅ Certificates renewed successfully for all ${totalCount} node(s)`);
    } else {
      this.logger.warn(`⚠️ Certificate renewal failed for ${totalCount - successCount} node(s)`);
    }
  }
  
  /**
   * Display certificate status in a table format
   */
  private displayCertificateStatus(results: any[], domain: string): void {
    const table = new Table({
      columns: [
        { name: 'node', title: 'Node', alignment: 'left' },
        { name: 'domain', title: 'Domain', alignment: 'left' },
        { name: 'status', title: 'Status', alignment: 'center' },
        { name: 'type', title: 'Certificate Type', alignment: 'left' },
        { name: 'expires', title: 'Expires', alignment: 'left' },
        { name: 'error', title: 'Error', alignment: 'left' }
      ]
    });
    
    results.forEach(result => {
      const statusIcon = result.isValid ? '✅' : (result.hasCertificate ? '⚠️' : '❌');
      const status = result.isValid ? 'Valid' : (result.hasCertificate ? 'Issues' : 'Missing');
      
      table.addRow({
        node: result.node,
        domain: `*.${domain}`,
        status: `${statusIcon} ${status}`,
        type: result.certificateType || 'none',
        expires: result.expiresAt ? new Date(result.expiresAt).toLocaleDateString() : '-',
        error: result.error ? result.error.substring(0, 50) + '...' : '-'
      });
    });
    
    console.log();
    table.printTable();
    console.log();
  }
  
  /**
   * Get the base domain for the cluster
   */
  private getClusterDomain(cluster: any): string {
    // Try to extract domain from cluster configuration or environment
    const configDomain = process.env.DYNIA_CF_DOMAIN;
    if (configDomain) {
      return configDomain;
    }
    
    // Fallback to a common pattern - you might need to adjust this
    // based on your cluster naming convention
    return 'thaitype.dev'; // This should be configurable
  }
  
  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
    
    // Check for required environment variables
    if (!process.env.DYNIA_CF_API_KEY) {
      throw new Error('DYNIA_CF_API_KEY environment variable is required for certificate management');
    }
  }
}