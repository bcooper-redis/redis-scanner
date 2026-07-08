#!/usr/bin/env node
import { Command } from 'commander';
import { registerScan } from './scan';
import { registerCredentialScan } from './credentialScan';
import { registerServe } from './serve';

const program = new Command();

program.name('rscan').description('Redis Discovery — Redis discovery & inventory').version('0.1.0');

registerScan(program);
registerCredentialScan(program);
registerServe(program);

program.parseAsync().catch((e: Error) => {
  process.stderr.write(`Error: ${e.message}\n`);
  process.exit(1);
});
