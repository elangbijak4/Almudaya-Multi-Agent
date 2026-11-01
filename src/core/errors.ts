/**
 * Error hierarchy for Almudaya Multi-Agent.
 */
export class AlmudayaError extends Error {
  public readonly code: string;

  constructor(message: string, code: string = 'ALMUDAYA_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ValidationError extends AlmudayaError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
  }
}

export class SessionNotFoundError extends AlmudayaError {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`, 'SESSION_NOT_FOUND');
  }
}

export class SessionAlreadyExistsError extends AlmudayaError {
  constructor(sessionId: string) {
    super(`Session already exists: ${sessionId}`, 'SESSION_ALREADY_EXISTS');
  }
}

export class BotAlreadyRegisteredError extends AlmudayaError {
  constructor(botId: string, sessionId: string) {
    super(`Bot "${botId}" is already registered in session "${sessionId}"`, 'BOT_ALREADY_REGISTERED');
  }
}

export class BotNotFoundError extends AlmudayaError {
  constructor(identifier: string, sessionId: string) {
    super(`Bot "${identifier}" not found in session "${sessionId}"`, 'BOT_NOT_FOUND');
  }
}

export class DisplayNameConflictError extends AlmudayaError {
  constructor(displayName: string, sessionId: string) {
    super(`Display name "${displayName}" is already in use in session "${sessionId}"`, 'DISPLAY_NAME_CONFLICT');
  }
}

export class MessageNotFoundError extends AlmudayaError {
  constructor(messageId: string, botId: string) {
    super(`Message "${messageId}" not found in inbox for bot "${botId}"`, 'MESSAGE_NOT_FOUND');
  }
}

export class CorruptedDataError extends AlmudayaError {
  constructor(path: string, details?: string) {
    super(`Corrupted data file at "${path}"${details ? `: ${details}` : ''}`, 'CORRUPTED_DATA');
  }
}

export class LockTimeoutError extends AlmudayaError {
  constructor(lockPath: string, timeoutMs: number) {
    super(`Timed out waiting for lock at "${lockPath}" after ${timeoutMs}ms`, 'LOCK_TIMEOUT');
  }
}

export class LockAcquisitionError extends AlmudayaError {
  constructor(lockPath: string, reason: string) {
    super(`Failed to acquire lock at "${lockPath}": ${reason}`, 'LOCK_ACQUISITION_ERROR');
  }
}
