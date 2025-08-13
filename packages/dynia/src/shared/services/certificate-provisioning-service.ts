import type { ILogger } from '@thaitype/core-utils';
import { SSHExecutor } from '../utils/ssh.js';
import type { ClusterNode } from '../types/index.js';

export interface CertificateProvisioningOptions {
  domain: string;
  cluster: {
    name: string;
    nodes: ClusterNode[];
  };
  dryRun?: boolean;
  verbose?: boolean;
}

export interface CertificateStatus {
  domain: string;
  node: string;
  hasCertificate: boolean;
  certificateType: 'origin' | 'self-signed' | 'none';
  expiresAt?: string;
  isValid: boolean;
  error?: string;
}

/**
 * Service for managing SSL certificates across cluster nodes
 * Handles Cloudflare Origin Certificates and fallback self-signed certificates
 */
export class CertificateProvisioningService {
  constructor(private readonly logger: ILogger) {}

  /**
   * Provision certificates for all nodes in a cluster
   */
  async provisionCertificates(options: CertificateProvisioningOptions): Promise<CertificateStatus[]> {
    const { domain, cluster, dryRun = false, verbose = false } = options;
    
    this.logger.info(`${dryRun ? '[DRY RUN] ' : ''}Provisioning certificates for *.${domain}...`);
    
    const results: CertificateStatus[] = [];
    
    for (const node of cluster.nodes) {
      this.logger.info(`Processing node: ${node.twoWordId} (${node.publicIp})`);
      
      try {
        const status = await this.provisionNodeCertificate(node, domain, { dryRun, verbose });
        results.push(status);
      } catch (error) {
        this.logger.error(`Failed to provision certificate for ${node.twoWordId}: ${error}`);
        results.push({
          domain,
          node: node.twoWordId,
          hasCertificate: false,
          certificateType: 'none',
          isValid: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    return results;
  }

  /**
   * Check certificate status for all nodes in a cluster
   */
  async checkCertificateStatus(domain: string, nodes: ClusterNode[]): Promise<CertificateStatus[]> {
    this.logger.info(`Checking certificate status for *.${domain}...`);
    
    const results: CertificateStatus[] = [];
    
    for (const node of nodes) {
      try {
        const status = await this.checkNodeCertificateStatus(node, domain);
        results.push(status);
      } catch (error) {
        this.logger.error(`Failed to check certificate status for ${node.twoWordId}: ${error}`);
        results.push({
          domain,
          node: node.twoWordId,
          hasCertificate: false,
          certificateType: 'none',
          isValid: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    return results;
  }

  /**
   * Provision certificate for a single node
   */
  private async provisionNodeCertificate(
    node: ClusterNode, 
    domain: string, 
    options: { dryRun: boolean; verbose: boolean }
  ): Promise<CertificateStatus> {
    const ssh = new SSHExecutor(node.publicIp, this.logger);
    const { dryRun, verbose } = options;
    
    if (verbose) {
      this.logger.info(`Setting up certificate directories on ${node.twoWordId}...`);
    }
    
    if (!dryRun) {
      // Setup certificate directories
      await ssh.executeCommand('mkdir -p /etc/haproxy/certs /etc/haproxy/backup /etc/ssl/private');
      await ssh.executeCommand('chmod 700 /etc/haproxy/certs');
    }
    
    // Check if certificates already exist
    const hasExistingCerts = !dryRun ? await this.hasValidCertificates(ssh, domain) : false;
    
    if (hasExistingCerts) {
      this.logger.info(`✅ Valid certificates already exist for ${node.twoWordId}`);
      return {
        domain,
        node: node.twoWordId,
        hasCertificate: true,
        certificateType: 'origin', // Assume origin cert if valid
        isValid: true
      };
    }
    
    if (verbose) {
      this.logger.info(`Provisioning new certificate for ${node.twoWordId}...`);
    }
    
    // Try to provision Cloudflare Origin Certificate
    try {
      const certificateContent = await this.provisionCloudflareOriginCertificate(ssh, domain, { dryRun, verbose });
      
      if (!dryRun && certificateContent) {
        await this.installCertificate(ssh, domain, certificateContent);
        this.logger.info(`✅ Cloudflare Origin Certificate installed for ${node.twoWordId}`);
        
        return {
          domain,
          node: node.twoWordId,
          hasCertificate: true,
          certificateType: 'origin',
          isValid: true
        };
      }
    } catch (error) {
      this.logger.warn(`Cloudflare Origin Certificate failed for ${node.twoWordId}: ${error}`);
      
      if (verbose) {
        this.logger.warn('Falling back to self-signed certificate...');
      }
      
      // Fallback to self-signed certificate
      if (!dryRun) {
        await this.generateSelfSignedCertificate(ssh, domain);
        this.logger.info(`✅ Self-signed certificate generated for ${node.twoWordId}`);
      }
      
      return {
        domain,
        node: node.twoWordId,
        hasCertificate: true,
        certificateType: 'self-signed',
        isValid: true
      };
    }
    
    return {
      domain,
      node: node.twoWordId,
      hasCertificate: dryRun,
      certificateType: dryRun ? 'origin' : 'none',
      isValid: dryRun
    };
  }

  /**
   * Check certificate status for a single node
   */
  private async checkNodeCertificateStatus(node: ClusterNode, domain: string): Promise<CertificateStatus> {
    const ssh = new SSHExecutor(node.publicIp, this.logger);
    
    // Check if certificate files exist
    const pemPath = `/etc/haproxy/certs/${domain}.pem`;
    const crtPath = `/etc/haproxy/certs/${domain}.crt`;
    
    try {
      const pemExists = await ssh.executeCommand(`test -f ${pemPath} && echo "exists" || echo "missing"`);
      const crtExists = await ssh.executeCommand(`test -f ${crtPath} && echo "exists" || echo "missing"`);
      
      if (pemExists.trim() !== 'exists' || crtExists.trim() !== 'exists') {
        return {
          domain,
          node: node.twoWordId,
          hasCertificate: false,
          certificateType: 'none',
          isValid: false
        };
      }
      
      // Check certificate validity
      const certInfo = await ssh.executeCommand(`openssl x509 -in ${crtPath} -noout -dates -subject 2>/dev/null || echo "invalid"`);
      
      if (certInfo.trim() === 'invalid') {
        return {
          domain,
          node: node.twoWordId,
          hasCertificate: true,
          certificateType: 'self-signed', // Default to self-signed if we can't determine type
          isValid: false
        };
      }
      
      // Parse certificate info
      const isOriginCert = certInfo.includes('Cloudflare Origin Certificate');
      const expiryMatch = certInfo.match(/notAfter=(.+)/);
      const expiresAt = expiryMatch ? expiryMatch[1].trim() : undefined;
      
      return {
        domain,
        node: node.twoWordId,
        hasCertificate: true,
        certificateType: isOriginCert ? 'origin' : 'self-signed',
        expiresAt,
        isValid: true
      };
      
    } catch (error) {
      return {
        domain,
        node: node.twoWordId,
        hasCertificate: false,
        certificateType: 'none',
        isValid: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Check if valid certificates already exist
   */
  private async hasValidCertificates(ssh: SSHExecutor, domain: string): Promise<boolean> {
    try {
      const pemPath = `/etc/haproxy/certs/${domain}.pem`;
      const crtPath = `/etc/haproxy/certs/${domain}.crt`;
      
      const result = await ssh.executeCommand(`test -f ${crtPath} && test -f ${pemPath} && echo "exists" || echo "missing"`);
      return result.trim() === 'exists';
    } catch {
      return false;
    }
  }

  /**
   * Provision Cloudflare Origin Certificate
   */
  private async provisionCloudflareOriginCertificate(
    ssh: SSHExecutor, 
    domain: string, 
    options: { dryRun: boolean; verbose: boolean }
  ): Promise<string | null> {
    const { dryRun, verbose } = options;
    
    // Get the Cloudflare User Service Key from environment
    const cfApiKey = process.env.DYNIA_CF_API_KEY;
    
    if (!cfApiKey) {
      throw new Error('DYNIA_CF_API_KEY environment variable is required for Origin Certificate generation');
    }
    
    if (verbose) {
      this.logger.info('Generating CSR for Cloudflare Origin Certificate...');
    }
    
    if (dryRun) {
      this.logger.info('[DRY RUN] Would generate CSR and call Cloudflare Origin CA API');
      return 'mock-certificate-content';
    }
    
    // Generate CSR
    const keyPath = `/etc/haproxy/certs/${domain}.key`;
    const csrPath = `/etc/haproxy/certs/${domain}.csr`;
    
    await ssh.executeCommand(`
      openssl req -new -newkey rsa:2048 -nodes \\
        -keyout ${keyPath} \\
        -out ${csrPath} \\
        -subj "/CN=*.${domain}"
    `);
    
    // Read CSR content
    const csrContent = await ssh.executeCommand(`cat ${csrPath}`);
    
    // Call Cloudflare Origin CA API
    const certificateContent = await this.callCloudflareOriginAPI(ssh, domain, csrContent.trim(), verbose);
    
    // Clean up CSR file
    await ssh.executeCommand(`rm -f ${csrPath}`);
    
    return certificateContent;
  }

  /**
   * Call Cloudflare Origin CA API to generate certificate from CSR
   */
  private async callCloudflareOriginAPI(ssh: SSHExecutor, domain: string, csrContent: string, verbose: boolean): Promise<string> {
    if (verbose) {
      this.logger.info('Calling Cloudflare Origin CA API...');
    }
    
    const cfApiKey = process.env.DYNIA_CF_API_KEY;
    
    if (!cfApiKey) {
      throw new Error('DYNIA_CF_API_KEY environment variable is required');
    }
    
    // Create JSON payload - CSR content will be properly escaped by JSON.stringify
    const jsonPayload = {
      hostnames: [`*.${domain}`],
      request_type: 'origin-rsa',
      requested_validity: 5475, // ~15 years (must be integer per Cloudflare API spec)
      csr: csrContent.trim()  // JSON.stringify will handle \n escaping automatically
    };
    
    // Create temporary file for JSON payload using cat with here document
    const tempFile = `/tmp/cf-api-payload-${Date.now()}.json`;
    const jsonString = JSON.stringify(jsonPayload);
    
    // Use cat with here document to write JSON safely
    await ssh.executeCommand(`cat > ${tempFile} << 'EOFJSON'
${jsonString}
EOFJSON`);
    
    if (verbose) {
      // Debug: Show the JSON file content
      const fileContent = await ssh.executeCommand(`cat ${tempFile}`);
      this.logger.debug(`JSON payload: ${fileContent}`);
    }
    
    // Make API call using heredoc for data instead of file
    // Need to escape single quotes in the JSON for shell
    const escapedJsonString = jsonString.replace(/'/g, "'\"'\"'");
    const apiCall = `curl -sX POST https://api.cloudflare.com/client/v4/certificates \\
      -H "Content-Type: application/json" \\
      -H "X-Auth-User-Service-Key: ${cfApiKey}" \\
      -d '${escapedJsonString}'`;
    
    const response = await ssh.executeCommand(apiCall);
    
    // Clean up temporary file
    await ssh.executeCommand(`rm -f ${tempFile}`);
    
    if (verbose) {
      this.logger.debug(`Cloudflare API response: ${response}`);
    }
    
    // Parse response
    let apiResponse;
    try {
      apiResponse = JSON.parse(response);
    } catch (error) {
      throw new Error(`Invalid API response: ${response}`);
    }
    
    if (!apiResponse.success) {
      const errors = apiResponse.errors?.map((e: any) => e.message).join(', ') || 'Unknown error';
      throw new Error(`Cloudflare API error: ${errors}`);
    }
    
    if (!apiResponse.result?.certificate) {
      throw new Error('No certificate returned from Cloudflare API');
    }
    
    return apiResponse.result.certificate;
  }

  /**
   * Install certificate on the node
   */
  private async installCertificate(ssh: SSHExecutor, domain: string, certificateContent: string): Promise<void> {
    const keyPath = `/etc/haproxy/certs/${domain}.key`;
    const crtPath = `/etc/haproxy/certs/${domain}.crt`;
    const pemPath = `/etc/haproxy/certs/${domain}.pem`;
    
    // Write certificate to file
    await ssh.executeCommand(`cat > ${crtPath} << 'EOFCERT'
${certificateContent}
EOFCERT`);
    
    // Create HAProxy PEM format (cert + key)
    await ssh.executeCommand(`
      cat ${crtPath} ${keyPath} > ${pemPath} &&
      chmod 600 ${pemPath} ${keyPath} ${crtPath} &&
      chown root:root ${pemPath} ${keyPath} ${crtPath}
    `);
    
    this.logger.info(`Certificate installed: ${pemPath}`);
  }

  /**
   * Generate self-signed certificate as fallback
   */
  private async generateSelfSignedCertificate(ssh: SSHExecutor, domain: string): Promise<void> {
    const keyPath = `/etc/haproxy/certs/${domain}.key`;
    const crtPath = `/etc/haproxy/certs/${domain}.crt`;
    const pemPath = `/etc/haproxy/certs/${domain}.pem`;
    
    await ssh.executeCommand(`
      cd /etc/haproxy/certs &&
      openssl req -x509 -nodes -days 365 -newkey rsa:2048 \\
        -keyout ${domain}.key -out ${domain}.crt \\
        -subj "/C=US/ST=State/L=City/O=Dynia/CN=*.${domain}" && 
      cat ${domain}.crt ${domain}.key > ${domain}.pem &&
      chmod 600 ${domain}.pem &&
      rm -f ${domain}.key ${domain}.crt
    `);
    
    this.logger.info(`Self-signed certificate generated: ${pemPath}`);
  }
}