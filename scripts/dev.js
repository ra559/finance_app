#!/usr/bin/env node
// Runs the API and the Vite dev server together with one command.
import { spawn } from 'node:child_process';

const children = [];
let shuttingDown = false;

function run(command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`\n[dev] ${command} exited with code ${code ?? 0}`);
      shutdown(code ?? 0);
    }
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 200);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
run(process.execPath, ['server/index.js'], { NODE_ENV: 'development' });
run(npm, ['exec', '--', 'vite', '--config', 'vite.config.js']);
