import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerSecret, unregisterSecret } from '../../src/execution/environment.js';
import { PathTraversalSecurityError } from '../../src/tools/sandbox.js';
import { executeInspectWebUi, executeWebFetch } from '../../src/tools/web-tools.js';

describe('Web & UI Self-Verification Tools (`web_fetch`, `inspect_web_ui`)', () => {
  let tmpDir: string;
  let server: http.Server;
  let baseUrl: string;
  const testSecret = 'sk-test-secret-redaction-1234567890';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'almudaya-webtools-'));
    registerSecret(testSecret);

    server = http.createServer((req, res) => {
      if (req.url === '/styles.css') {
        res.writeHead(200, { 'Content-Type': 'text/css' });
        res.end(`
          .glass-card {
            background: rgba(15, 23, 42, 0.55);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
          }
        `);
        return;
      }

      if (req.url === '/flat') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head><title>Flat Page</title></head><body><div>No blur</div></body></html>');
        return;
      }

      if (req.url === '/secret') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`token=${testSecret}`);
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!doctype html>
        <html>
          <head>
            <title>Almudaya Quantum Lab</title>
            <link rel="stylesheet" href="/styles.css">
          </head>
          <body>
            <div class="glass-card" draggable="true" ondragstart="handleDrag()">H Gate</div>
            <canvas id="bloch"></canvas>
            <button>RUN</button>
          </body>
        </html>
      `);
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    unregisterSecret(testSecret);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('web_fetch allows loopback requests, redacts secrets, and rejects non-loopback hosts fail-closed', async () => {
    const okRes = await executeWebFetch({ url: `${baseUrl}/` });
    expect(okRes.status).toBe(200);
    expect(okRes.ok).toBe(true);
    expect(okRes.bodySnippet).toContain('Almudaya Quantum Lab');

    const redactedRes = await executeWebFetch({ url: `${baseUrl}/secret` });
    expect(redactedRes.bodySnippet).not.toContain(testSecret);
    expect(redactedRes.bodySnippet).toContain('[REDACTED');

    await expect(
      executeWebFetch({ url: 'https://example.com/secret' })
    ).rejects.toThrow(/Access denied \(web_fetch\)/);
  });

  it('inspect_web_ui audits glassmorphism CSS, draggable hooks, warnings on flat pages, and sandboxed screenshot paths', async () => {
    const glassReport = await executeInspectWebUi([tmpDir], {
      url: `${baseUrl}/`,
      disable_browser_probe: true,
    });
    expect(glassReport.httpStatus).toBe(200);
    expect(glassReport.title).toBe('Almudaya Quantum Lab');
    expect(glassReport.glassmorphismAudit.hasBackdropFilterCss).toBe(true);
    expect(glassReport.glassmorphismAudit.backdropBlurElements).toBeGreaterThanOrEqual(2);
    expect(glassReport.glassmorphismAudit.translucentSurfaces).toBeGreaterThanOrEqual(1);
    expect(glassReport.glassmorphismAudit.warnings).toHaveLength(0);
    expect(glassReport.interactiveAudit.draggableCount).toBe(1);
    expect(glassReport.interactiveAudit.canvasCount).toBe(1);
    expect(glassReport.interactiveAudit.buttonCount).toBe(1);

    const flatReport = await executeInspectWebUi([tmpDir], {
      url: `${baseUrl}/flat`,
      disable_browser_probe: true,
    });
    expect(flatReport.glassmorphismAudit.hasBackdropFilterCss).toBe(false);
    expect(flatReport.glassmorphismAudit.warnings.length).toBeGreaterThanOrEqual(1);

    await expect(
      executeInspectWebUi([tmpDir], {
        url: `${baseUrl}/`,
        screenshot_path: '../outside-escape.png',
        disable_browser_probe: true,
      })
    ).rejects.toThrow(PathTraversalSecurityError);
  });
});
