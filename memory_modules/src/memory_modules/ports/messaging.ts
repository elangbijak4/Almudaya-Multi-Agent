export interface MessageKnowledgeReferences {
  knowledgeRefs?: string[];
  executionRefs?: string[];
  checkpointRef?: string;
}

/** Optional extension metadata. Existing DirectMessage payload and delivery contract remain unchanged. */
export interface IKnowledgeAwareMessagingBridge {
  attachKnowledgeReferences(messageId: string, references: MessageKnowledgeReferences): Promise<void>;
  resolveKnowledgeReferences(messageId: string, principalId: string): Promise<MessageKnowledgeReferences>;
}
