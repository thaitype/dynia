import { BaseCommand } from '../../shared/base/base-command.js';

export interface ClusterDestroyOptions {
  name: string;
  confirm?: boolean;
}

export class ClusterDestroyCommand extends BaseCommand<ClusterDestroyOptions> {
  protected async run(): Promise<void> {
    // TODO: Implement cluster destruction
    this.logger.info('Cluster destroy command - Coming soon!');
    throw new Error('Cluster destroy command not yet implemented');
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
  }
}