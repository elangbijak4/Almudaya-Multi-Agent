import { describe, it, expect } from 'vitest';
import { VERSION, CLI_NAME, PACKAGE_NAME } from '../src/core/version.js';
import { createProgram } from '../src/cli/index.js';

describe('Core Version & Metadata', () => {
  it('should export expected package metadata constants', () => {
    expect(PACKAGE_NAME).toBe('almudaya-multiagent');
    expect(VERSION).toBe('0.2.0');
    expect(CLI_NAME).toBe('almudaya');
  });
});

describe('CLI Commander Program', () => {
  it('should configure the CLI name, version, and description correctly', () => {
    const program = createProgram();
    expect(program.name()).toBe('almudaya');
    expect(program.version()).toBe('0.2.0');
    expect(program.description()).toContain('Almudaya Multi-Agent CLI');
  });

  it('should display help information without error', () => {
    const program = createProgram();
    program.exitOverride(); // Prevent process.exit during test
    const helpInformation = program.helpInformation();
    expect(helpInformation).toContain('Usage: almudaya [options]');
    expect(helpInformation).toContain('-v, --version');
    expect(helpInformation).toContain('-h, --help');
  });
});
