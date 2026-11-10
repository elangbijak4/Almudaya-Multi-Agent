/**
 * PKU memory domain contracts. No storage backend or runtime side effects are
 * introduced by importing this module. Runtime integration is intentionally
 * deferred until the legacy compatibility and migration gates are approved.
 */
export * from './contracts/types.js';
export * from './ports/pku-store.js';
export * from './ports/registers.js';
export * from './ports/knowledge-optimization.js';
export * from './ports/lifecycle.js';
export * from './ports/messaging.js';
export * from './ports/external-adapter.js';
