import { ConsoleLogger } from '@thaitype/core-utils';

import { cliEntryPoint } from './cli-interfaces/entrypoint.js';
import { handlerError } from './internal/error.js';
import { version } from './version.js';

// Set up the CLI entry point
// This is the main entry point for the CLI application.
cliEntryPoint(process.argv, {
  version,
  scriptName: 'dynia',
}).catch(err => {
  handlerError(err, new ConsoleLogger('silent'), 99);
});
