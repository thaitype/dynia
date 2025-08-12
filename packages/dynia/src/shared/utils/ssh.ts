import { join } from 'path';
import { homedir } from 'os';
import type { ILogger } from '@thaitype/core-utils';

/**
 * SSH command execution utility
 */
export class SSHExecutor {
  private readonly keyPath: string;

  constructor(
    private readonly ip: string,
    private readonly logger: ILogger,
    private readonly username: string = 'root',
    keyName: string = 'dynia'
  ) {
    this.keyPath = join(homedir(), '.ssh', keyName);
  }

  /**
   * Execute a command via SSH
   */
  async executeCommand(command: string): Promise<string> {
    this.logger.debug(`SSH ${this.ip}: ${command}`);

    // In a real implementation, this would use a proper SSH library like 'ssh2'
    // For now, we'll use a simple approach with child_process and ssh command
    const { spawn } = await import('child_process');
    
    return new Promise((resolve, reject) => {
      const sshArgs = [
        '-i', this.keyPath,
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'ConnectTimeout=30',
        `${this.username}@${this.ip}`,
        command
      ];

      const sshProcess = spawn('ssh', sshArgs, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      sshProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      sshProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      sshProcess.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`SSH command failed (exit code ${code}): ${stderr.trim()}`));
        }
      });

      sshProcess.on('error', (error) => {
        reject(new Error(`SSH process error: ${error.message}`));
      });
    });
  }

  /**
   * Copy a file to the remote server
   */
  async copyFile(localPath: string, remotePath: string): Promise<void> {
    this.logger.debug(`SCP ${localPath} -> ${this.ip}:${remotePath}`);

    const { spawn } = await import('child_process');
    
    return new Promise((resolve, reject) => {
      const scpArgs = [
        '-i', this.keyPath,
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'ConnectTimeout=30',
        localPath,
        `${this.username}@${this.ip}:${remotePath}`
      ];

      const scpProcess = spawn('scp', scpArgs, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stderr = '';

      scpProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      scpProcess.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`SCP command failed (exit code ${code}): ${stderr.trim()}`));
        }
      });

      scpProcess.on('error', (error) => {
        reject(new Error(`SCP process error: ${error.message}`));
      });
    });
  }

  /**
   * Copy content as a file to the remote server
   */
  async copyContent(content: string, remotePath: string): Promise<void> {
    this.logger.debug(`Creating remote file: ${this.ip}:${remotePath}`);

    // Create file using echo and proper escaping
    const command = `cat > "${remotePath}" << 'EOF'\n${content}\nEOF`;
    
    await this.executeCommand(command);
  }

  /**
   * Test SSH connectivity
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.executeCommand('echo "SSH connection test"');
      return true;
    } catch (error) {
      this.logger.error(`SSH connection test failed: ${error}`);
      return false;
    }
  }

  /**
   * Wait for SSH to become available
   */
  async waitForConnection(timeoutMs: number = 300000, intervalMs: number = 10000): Promise<void> {
    this.logger.info(`Waiting for SSH connection to ${this.ip}...`);

    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (await this.testConnection()) {
        this.logger.info(`✅ SSH connection to ${this.ip} is ready`);
        return;
      }

      this.logger.debug(`SSH not ready, retrying in ${intervalMs / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error(`SSH connection to ${this.ip} failed to establish within ${timeoutMs / 1000}s`);
  }
}