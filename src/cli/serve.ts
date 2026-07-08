import type { Command } from 'commander';
import { createApp } from '../web/index';

export function registerServe(program: Command): void {
  program
    .command('serve')
    .description('Start the web UI')
    .option('--port <port>', 'HTTP port to listen on', '3000')
    .option('--host <host>', 'HTTP host to bind', 'localhost')
    .action((opts: { port: string; host: string }) => {
      const port = parseInt(opts.port, 10) || 3000;
      const host = opts.host;
      const app = createApp();
      app.listen(port, host, () => {
        process.stderr.write(`Redis Discovery web UI listening on http://${host}:${port}\n`);
      });
    });
}
