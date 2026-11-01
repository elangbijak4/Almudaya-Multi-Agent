#!/usr/bin/env node
import process from 'node:process';
import { run } from './index.js';

run().catch((error: unknown) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

