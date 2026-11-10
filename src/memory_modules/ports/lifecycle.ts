import type { MemoryLifecyclePlan, MemoryLifecycleRequest } from '../contracts/types.js';

export interface IMemoryLifecycleManager {
  plan(request: MemoryLifecycleRequest): Promise<MemoryLifecyclePlan>;
  execute(plan: MemoryLifecyclePlan, confirmationToken?: string): Promise<void>;
}
