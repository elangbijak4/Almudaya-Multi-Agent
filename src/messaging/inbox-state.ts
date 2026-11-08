import type { InboxDeliveryState, DirectMessage } from './schema.js';

export const DEFAULT_MESSAGE_LEASE_MS = 30000;
export const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Validates state transitions in the Inbox Delivery State Machine (§13.1, §5.14).
 *
 * RECEIVED -> PROCESSING -> COMPLETED
 *                        -> RETRY_PENDING -> PROCESSING
 *                        -> DEAD_LETTER
 */
export function isValidStateTransition(
  current: InboxDeliveryState,
  target: InboxDeliveryState
): boolean {
  if (current === target) return true;

  switch (current) {
    case 'RECEIVED':
      return target === 'PROCESSING' || target === 'COMPLETED';

    case 'PROCESSING':
      return (
        target === 'COMPLETED' ||
        target === 'RETRY_PENDING' ||
        target === 'DEAD_LETTER' ||
        target === 'RECEIVED'
      );

    case 'RETRY_PENDING':
      return (
        target === 'PROCESSING' ||
        target === 'DEAD_LETTER' ||
        target === 'COMPLETED'
      );

    case 'COMPLETED':
      return false; // Terminal state

    case 'DEAD_LETTER':
      return target === 'RETRY_PENDING'; // Can be manually re-queued by admin

    default:
      return false;
  }
}

/**
 * Checks if a processing lease on an inbox message has expired.
 */
export function isMessageLeaseExpired(message: DirectMessage, nowMs: number = Date.now()): boolean {
  if (!message.lease_expires_at) {
    return true;
  }
  const expiryTime = new Date(message.lease_expires_at).getTime();
  return isNaN(expiryTime) || nowMs >= expiryTime;
}
