import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FilesystemSessionStorage } from '../../src/blackboard/filesystem.js';
import { SessionService } from '../../src/session/service.js';
import {
  SessionAlreadyExistsError,
  SessionNotFoundError,
  ValidationError,
  CorruptedDataError,
} from '../../src/core/errors.js';

describe('Filesystem Session Storage & Durability', () => {
  let tmpWorkspace: string;
  let storage: FilesystemSessionStorage;
  let service: SessionService;

  beforeEach(async () => {
    tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-bb-test-'));
    storage = new FilesystemSessionStorage(tmpWorkspace);
    service = new SessionService(storage);
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('should create session and expected directory hierarchy', async () => {
    const session = await service.createSession({
      sessionId: 'S001',
      sessionName: 'Test Session',
      description: 'Initial session for test',
    });

    expect(session.session_id).toBe('S001');
    expect(session.session_name).toBe('Test Session');
    expect(session.status).toBe('active');
    expect(session.schema_version).toBe('1.0.0');

    const sessionDir = service.getSessionDir('S001');
    expect(await fs.access(sessionDir).then(() => true)).toBe(true);
    expect(await fs.access(path.join(sessionDir, 'registry')).then(() => true)).toBe(true);
    expect(await fs.access(path.join(sessionDir, 'broadcast')).then(() => true)).toBe(true);
    expect(await fs.access(path.join(sessionDir, 'inbox')).then(() => true)).toBe(true);
    expect(await fs.access(path.join(sessionDir, 'session.json')).then(() => true)).toBe(true);
  });

  it('should prevent duplicate session ID creation', async () => {
    await service.createSession({
      sessionId: 'S001',
      sessionName: 'First Creation',
    });

    await expect(
      service.createSession({
        sessionId: 'S001',
        sessionName: 'Duplicate Attempt',
      })
    ).rejects.toThrow(SessionAlreadyExistsError);
  });

  it('should throw SessionNotFoundError when retrieving non-existent session', async () => {
    await expect(service.getSession('NON_EXISTENT')).rejects.toThrow(SessionNotFoundError);
  });

  it('should survive process restart (durability across instances)', async () => {
    await service.createSession({
      sessionId: 'S001',
      sessionName: 'Persistent Session',
      description: 'Must survive restart',
    });

    // Simulate complete process restart with fresh storage & service instances
    const newStorage = new FilesystemSessionStorage(tmpWorkspace);
    const newService = new SessionService(newStorage);

    const reloaded = await newService.getSession('S001');
    expect(reloaded.session_id).toBe('S001');
    expect(reloaded.session_name).toBe('Persistent Session');
    expect(reloaded.description).toBe('Must survive restart');
    expect(reloaded.status).toBe('active');
  });

  it('should update session metadata under lock and update timestamp', async () => {
    const created = await service.createSession({
      sessionId: 'S001',
      sessionName: 'Original Name',
    });

    // Brief pause to ensure updated_at differs from created_at
    await new Promise((r) => setTimeout(r, 10));

    const updated = await service.updateSession('S001', {
      sessionName: 'Updated Name',
      description: 'New Description',
      status: 'archived',
    });

    expect(updated.session_name).toBe('Updated Name');
    expect(updated.description).toBe('New Description');
    expect(updated.status).toBe('archived');
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(created.created_at).getTime()
    );
  });

  it('should list multiple sessions ordered by creation date descending', async () => {
    await service.createSession({ sessionId: 'S001', sessionName: 'First' });
    await new Promise((r) => setTimeout(r, 15));
    await service.createSession({ sessionId: 'S002', sessionName: 'Second' });

    const list = await service.listSessions();
    expect(list.length).toBe(2);
    expect(list[0]?.session_id).toBe('S002');
    expect(list[1]?.session_id).toBe('S001');
  });

  it('should throw ValidationError for malformed session ID', async () => {
    await expect(
      service.createSession({
        sessionId: 'invalid/id with spaces',
        sessionName: 'Bad ID',
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should throw CorruptedDataError if session.json contains invalid JSON syntax', async () => {
    await service.createSession({ sessionId: 'S001', sessionName: 'Corrupt Me' });
    const sessionFile = path.join(service.getSessionDir('S001'), 'session.json');

    await fs.writeFile(sessionFile, '{ malformed json: not valid', 'utf-8');

    await expect(service.getSession('S001')).rejects.toThrow(CorruptedDataError);
  });

  it('should throw ValidationError if session.json fails schema validation', async () => {
    await service.createSession({ sessionId: 'S001', sessionName: 'Invalid Schema' });
    const sessionFile = path.join(service.getSessionDir('S001'), 'session.json');

    // Missing required fields
    await fs.writeFile(sessionFile, JSON.stringify({ broken: true }), 'utf-8');

    await expect(service.getSession('S001')).rejects.toThrow(ValidationError);
  });
});
