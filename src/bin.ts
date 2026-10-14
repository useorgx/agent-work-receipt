#!/usr/bin/env node
import { AWR_VERIFY_EXIT, nodeAwrVerifyIo, runAwrVerify } from './cli.ts';

runAwrVerify(process.argv.slice(2), nodeAwrVerifyIo).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `awr-verify: internal error: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = AWR_VERIFY_EXIT.internal;
  }
);
