import type { CommandModule } from 'yargs';

import type { GlobalConfigOptions } from '../../internal/types.js';
import { createCommandHandler } from '../../shared/base/base-command.js';
import { AppDeployCommand } from './app-deploy.js';

/**
 * Application deployment command module
 */
export const appCommand: CommandModule<GlobalConfigOptions> = {
  command: 'app <action>',
  describe: 'Manage application deployments',
  builder: yargs =>
    yargs
      .command({
        command: 'deploy',
        describe: 'Deploy an application to a node',
        builder: yargs =>
          yargs
            .option('node', {
              type: 'string',
              describe: 'Target node name',
              demandOption: true,
            })
            .option('compose', {
              type: 'string',
              describe: 'Path to docker-compose file',
              demandOption: true,
            })
            .example('$0 app deploy --node web-1 --compose ./app.yml', 'Deploy app.yml to web-1 node')
            .example('$0 app deploy --node api-1 --compose ./docker-compose.yml', 'Deploy to api-1 node'),
        handler: createCommandHandler(AppDeployCommand),
      })
      .demandCommand(1, 'Please specify an app action')
      .help(),
  handler: () => {
    // This will never be called due to demandCommand(1)
  },
};
