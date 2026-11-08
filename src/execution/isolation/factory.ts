import process from 'node:process';
import type { IIsolationBackend } from './interface.js';
import { WindowsJobIsolationBackend } from './windows.js';
import { LinuxNamespaceIsolationBackend } from './linux.js';
import { UnsupportedIsolationBackend } from './unsupported.js';

export function getIsolationBackend(): IIsolationBackend {
  if (process.platform === 'win32') {
    return new WindowsJobIsolationBackend();
  }
  if (process.platform === 'linux' || process.platform === 'darwin') {
    return new LinuxNamespaceIsolationBackend();
  }
  return new UnsupportedIsolationBackend();
}
