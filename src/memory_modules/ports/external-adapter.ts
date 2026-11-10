export interface MemoryAdapterCapabilities {
  read: boolean;
  write: boolean;
  search: boolean;
  semanticSearch: boolean;
  graphTraversal: boolean;
  export: boolean;
  import: boolean;
  incrementalSync: boolean;
  delete: boolean;
}

export interface MemoryAdapterManifest {
  adapterId: string;
  displayName: string;
  backendType: string;
  version: string;
  capabilities: MemoryAdapterCapabilities;
}

export interface IExternalMemoryAdapter {
  manifest(): MemoryAdapterManifest;
  connect(): Promise<void>;
  healthCheck(): Promise<{ healthy: boolean; details?: string }>;
  disconnect(): Promise<void>;
}
