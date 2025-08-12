import { BaseCommand } from '../../shared/base/base-command.js';

export interface ClusterNodeAddOptions {
  name: string;
  count?: number;
}

export class ClusterNodeAddCommand extends BaseCommand<ClusterNodeAddOptions> {
  protected async run(): Promise<void> {
    // TODO: Implement node addition
    this.logger.info('Cluster node add command - Coming soon!');
    throw new Error('Cluster node add command not yet implemented');
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
  }
}