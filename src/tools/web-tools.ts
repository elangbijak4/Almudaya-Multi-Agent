import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { ToolDefinition } from '../ai/provider.js';
import { redactSecrets } from '../execution/environment.js';
import type { ExecutionContext } from '../execution/types.js';
import { validateSandboxedPath } from './sandbox.js';

const require = createRequire(import.meta.url);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function isLoopbackHttpUrl(rawUrl: string): { valid: boolean; parsed?: URL; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: `Invalid URL "${rawUrl}".` };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      reason: `Unsupported URL protocol "${parsed.protocol}". Only http: and https: are allowed.`,
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    return {
      valid: false,
      reason: `Host "${host}" is not a loopback address. Direct web tools restrict requests to localhost/127.0.0.1/[::1] (use an authorized MCP fetch/browser server for external hosts).`,
    };
  }

  return { valid: true, parsed };
}

export interface WebFetchArgs {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout_ms?: number;
  max_bytes?: number;
}

export interface WebFetchResult {
  url: string;
  status: number;
  ok: boolean;
  contentType: string;
  durationMs: number;
  headers: Record<string, string>;
  bodySnippet: string;
  truncated: boolean;
}

export async function executeWebFetch(
  args: WebFetchArgs,
  _context?: Partial<ExecutionContext>
): Promise<WebFetchResult> {
  const urlCheck = isLoopbackHttpUrl(String(args.url ?? '').trim());
  if (!urlCheck.valid || !urlCheck.parsed) {
    throw new Error(`Access denied (web_fetch): ${urlCheck.reason}`);
  }

  const method = (args.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) {
    throw new Error(`Unsupported HTTP method "${method}" for web_fetch.`);
  }

  const timeoutMs = Math.min(60000, Math.max(500, args.timeout_ms ?? 15000));
  const maxBytes = Math.min(256 * 1024, Math.max(256, args.max_bytes ?? 32768));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  const started = Date.now();

  try {
    const res = await fetch(urlCheck.parsed.toString(), {
      method,
      headers: args.headers,
      body: method !== 'GET' && method !== 'HEAD' ? args.body : undefined,
      signal: controller.signal,
    });
    const rawText = await res.text();
    const redacted = redactSecrets(rawText);
    const truncated = Buffer.byteLength(redacted, 'utf8') > maxBytes;
    const bodySnippet = truncated ? redacted.slice(0, maxBytes) : redacted;

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      responseHeaders[k] = redactSecrets(v);
    });

    return {
      url: urlCheck.parsed.toString(),
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get('content-type') ?? '',
      durationMs: Date.now() - started,
      headers: responseHeaders,
      bodySnippet,
      truncated,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface WebUiAction {
  type: 'click' | 'fill' | 'drag_and_drop' | 'wait_ms' | 'eval_selector_text';
  selector?: string;
  target_selector?: string;
  value?: string;
  ms?: number;
}

export interface InspectWebUiArgs {
  url: string;
  viewport?: { width?: number; height?: number };
  actions?: WebUiAction[];
  check_glassmorphism?: boolean;
  screenshot_path?: string;
  timeout_ms?: number;
  disable_browser_probe?: boolean;
}

export interface InspectWebUiResult {
  url: string;
  mode: 'playwright_node' | 'playwright_python' | 'static_fallback';
  httpStatus: number;
  ok: boolean;
  title: string;
  horizontalOverflowPx: number;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  glassmorphismAudit: {
    checked: boolean;
    backdropBlurElements: number;
    translucentSurfaces: number;
    hasBackdropFilterCss: boolean;
    warnings: string[];
  };
  interactiveAudit: {
    draggableCount: number;
    dragHandlerReferences: number;
    buttonCount: number;
    canvasCount: number;
    actionResults: Array<{
      action: string;
      success: boolean;
      stateChanged: boolean;
      detail?: string;
      error?: string;
    }>;
  };
  screenshotPath?: string;
  recommendation?: string;
}

function tryResolveNodePlaywright(): string | undefined {
  for (const pkg of ['playwright', 'playwright-core']) {
    try {
      return require.resolve(pkg);
    } catch {
      // try next
    }
  }
  return undefined;
}

async function runPythonPlaywrightInspect(
  payload: Record<string, unknown>,
  timeoutMs: number
): Promise<Partial<InspectWebUiResult> | undefined> {
  const pyScript = `
import json, sys
try:
    from playwright.sync_api import sync_playwright
except Exception:
    sys.exit(2)

cfg = json.loads(sys.stdin.read())
url = cfg["url"]
vp = cfg.get("viewport") or {"width": 1440, "height": 900}
actions = cfg.get("actions") or []
screenshot_path = cfg.get("screenshotPath")

console_errors = []
page_errors = []
failed_requests = []

with sync_playwright() as p:
    browser = None
    for launcher, opts in [
        (lambda: p.chromium.launch(headless=True), None),
        (lambda: p.chromium.launch(channel="msedge", headless=True), None),
        (lambda: p.chromium.launch(channel="chrome", headless=True), None),
    ]:
        try:
            browser = launcher()
            break
        except Exception:
            continue
    if browser is None:
        sys.exit(3)

    page = browser.new_page(viewport={"width": vp.get("width", 1440), "height": vp.get("height", 900)})
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.on("requestfailed", lambda r: failed_requests.append(r.url))

    resp = page.goto(url, wait_until="networkidle", timeout=cfg.get("timeoutMs", 25000))
    http_status = resp.status if resp else 0
    title = page.title()

    metrics = page.evaluate("""() => {
        const overflow = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
        const all = Array.from(document.querySelectorAll('*')).slice(0, 600);
        let blurCount = 0;
        let translucentCount = 0;
        for (const el of all) {
            const st = getComputedStyle(el);
            const bf = st.backdropFilter || st.webkitBackdropFilter || '';
            if (bf && bf !== 'none' && bf.includes('blur')) blurCount++;
            const bg = st.backgroundColor || '';
            const m = bg.match(/rgba\\([^,]+,[^,]+,[^,]+,\\s*([\\d.]+)\\)/);
            if (m && parseFloat(m[1]) > 0 && parseFloat(m[1]) < 0.96) translucentCount++;
        }
        return {
            overflow,
            blurCount,
            translucentCount,
            draggableCount: document.querySelectorAll('[draggable="true"]').length,
            buttonCount: document.querySelectorAll('button').length,
            canvasCount: document.querySelectorAll('canvas').length,
        };
    }""")

    action_results = []
    for act in actions:
        atype = act.get("type")
        before_snap = page.evaluate("() => document.body ? document.body.innerText.slice(0, 4000) : ''")
        try:
            if atype == "click":
                page.click(act["selector"], timeout=5000)
            elif atype == "fill":
                page.fill(act["selector"], act.get("value", ""), timeout=5000)
            elif atype == "drag_and_drop":
                page.drag_and_drop(act["selector"], act["target_selector"], timeout=5000)
            elif atype == "wait_ms":
                page.wait_for_timeout(int(act.get("ms", 250)))
            elif atype == "eval_selector_text":
                txt = page.locator(act["selector"]).inner_text(timeout=5000)
                action_results.append({"action": atype, "success": True, "stateChanged": False, "detail": txt[:500]})
                continue
            page.wait_for_timeout(150)
            after_snap = page.evaluate("() => document.body ? document.body.innerText.slice(0, 4000) : ''")
            action_results.append({
                "action": atype,
                "success": True,
                "stateChanged": before_snap != after_snap,
                "detail": f"selector={act.get('selector', '')}"
            })
        except Exception as exc:
            action_results.append({"action": atype, "success": False, "stateChanged": False, "error": str(exc)})

    if screenshot_path:
        page.screenshot(path=screenshot_path, full_page=True)

    browser.close()

print(json.dumps({
    "httpStatus": http_status,
    "title": title,
    "horizontalOverflowPx": metrics["overflow"],
    "consoleErrors": console_errors,
    "pageErrors": page_errors,
    "failedRequests": failed_requests,
    "glassmorphismAudit": {
        "checked": True,
        "backdropBlurElements": metrics["blurCount"],
        "translucentSurfaces": metrics["translucentCount"],
        "hasBackdropFilterCss": metrics["blurCount"] > 0,
        "warnings": []
    },
    "interactiveAudit": {
        "draggableCount": metrics["draggableCount"],
        "dragHandlerReferences": metrics["draggableCount"],
        "buttonCount": metrics["buttonCount"],
        "canvasCount": metrics["canvasCount"],
        "actionResults": action_results
    }
}))
`;

  for (const pyBin of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) {
    const out = await new Promise<string | undefined>((resolve) => {
      const child = execFile(pyBin, ['-c', pyScript], { timeout: timeoutMs }, (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve(undefined);
          return;
        }
        resolve(stdout.trim());
      });
      child.stdin?.write(JSON.stringify(payload));
      child.stdin?.end();
    });
    if (out) {
      try {
        return JSON.parse(out) as Partial<InspectWebUiResult>;
      } catch {
        // ignore invalid json
      }
    }
  }
  return undefined;
}

async function runStaticWebAudit(
  parsedUrl: URL,
  htmlText: string,
  httpStatus: number,
  checkGlass: boolean
): Promise<InspectWebUiResult> {
  const titleMatch = htmlText.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1]!.trim() : '';

  const cssHrefs = Array.from(
    htmlText.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)
  )
    .map((m) => m[1]!)
    .slice(0, 6);

  let combinedCss = htmlText;
  for (const href of cssHrefs) {
    try {
      const assetUrl = new URL(href, parsedUrl);
      if (isLoopbackHttpUrl(assetUrl.toString()).valid) {
        const res = await fetch(assetUrl.toString());
        if (res.ok) {
          combinedCss += '\n' + (await res.text());
        }
      }
    } catch {
      // Ignore unreachable stylesheet in static fallback
    }
  }

  const backdropMatches = combinedCss.match(/(?:-webkit-)?backdrop-filter\s*:\s*[^;]*blur\(/gi) ?? [];
  const translucentMatches = combinedCss.match(/rgba\([^)]+,\s*0?\.[0-8]\d*\)/gi) ?? [];
  const draggableMatches = htmlText.match(/draggable\s*=\s*["']true["']/gi) ?? [];
  const dragHandlerMatches =
    htmlText.match(/\b(?:ondragstart|ondrop|dragstart|dragover|drop)\b/gi) ?? [];
  const buttonMatches = htmlText.match(/<button\b/gi) ?? [];
  const canvasMatches = htmlText.match(/<canvas\b/gi) ?? [];

  const warnings: string[] = [];
  if (checkGlass && backdropMatches.length === 0) {
    warnings.push(
      'Glassmorphism audit found 0 `backdrop-filter: blur(...)` CSS rules in loaded HTML/CSS.'
    );
  }
  if (checkGlass && translucentMatches.length === 0) {
    warnings.push(
      'Glassmorphism audit found 0 translucent `rgba(..., <0.9)` surface definitions in loaded HTML/CSS.'
    );
  }

  return {
    url: parsedUrl.toString(),
    mode: 'static_fallback',
    httpStatus,
    ok: httpStatus >= 200 && httpStatus < 400,
    title,
    horizontalOverflowPx: 0,
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    glassmorphismAudit: {
      checked: checkGlass,
      backdropBlurElements: backdropMatches.length,
      translucentSurfaces: translucentMatches.length,
      hasBackdropFilterCss: backdropMatches.length > 0,
      warnings,
    },
    interactiveAudit: {
      draggableCount: draggableMatches.length,
      dragHandlerReferences: dragHandlerMatches.length,
      buttonCount: buttonMatches.length,
      canvasCount: canvasMatches.length,
      actionResults: [],
    },
    recommendation:
      'Live browser engine (Playwright) not detected locally. Configure `almudaya mcp preset playwright` or `almudaya mcp preset chrome-devtools` for live computed CSS, console-error, and drag-and-drop DOM state testing.',
  };
}

export async function executeInspectWebUi(
  projectRoots: string[],
  args: InspectWebUiArgs,
  _context?: Partial<ExecutionContext>
): Promise<InspectWebUiResult> {
  const urlCheck = isLoopbackHttpUrl(String(args.url ?? '').trim());
  if (!urlCheck.valid || !urlCheck.parsed) {
    throw new Error(`Access denied (inspect_web_ui): ${urlCheck.reason}`);
  }

  let validatedScreenshotPath: string | undefined;
  if (args.screenshot_path && args.screenshot_path.trim()) {
    validatedScreenshotPath = validateSandboxedPath(projectRoots, args.screenshot_path.trim());
    await fs.mkdir(path.dirname(validatedScreenshotPath), { recursive: true });
  }

  const timeoutMs = Math.min(60000, Math.max(2000, args.timeout_ms ?? 25000));
  const checkGlass = args.check_glassmorphism !== false;

  // Verify HTTP endpoint first
  const fetchRes = await executeWebFetch({
    url: urlCheck.parsed.toString(),
    method: 'GET',
    timeout_ms: Math.min(timeoutMs, 10000),
    max_bytes: 128 * 1024,
  });

  if (!args.disable_browser_probe) {
    const nodePwPath = tryResolveNodePlaywright();
    if (nodePwPath) {
      try {
        const pwMod = (await import(nodePwPath)) as {
          chromium?: { launch: (opts: Record<string, unknown>) => Promise<any> };
        };
        if (pwMod.chromium) {
          let browser: any;
          for (const opts of [
            { headless: true },
            { channel: 'msedge', headless: true },
            { channel: 'chrome', headless: true },
          ]) {
            try {
              browser = await pwMod.chromium.launch(opts);
              break;
            } catch {
              // try next browser binary
            }
          }
          if (browser) {
            try {
              const consoleErrors: string[] = [];
              const pageErrors: string[] = [];
              const failedRequests: string[] = [];
              const page = await browser.newPage({
                viewport: {
                  width: args.viewport?.width ?? 1440,
                  height: args.viewport?.height ?? 900,
                },
              });
              page.on('console', (msg: { type: () => string; text: () => string }) => {
                if (msg.type() === 'error') consoleErrors.push(redactSecrets(msg.text()));
              });
              page.on('pageerror', (err: Error) => {
                pageErrors.push(redactSecrets(err.message));
              });
              page.on('requestfailed', (req: { url: () => string }) => {
                failedRequests.push(req.url());
              });
              const navRes = await page.goto(urlCheck.parsed.toString(), {
                waitUntil: 'networkidle',
                timeout: timeoutMs,
              });
              const title = await page.title();
              const metrics = await page.evaluate(() => {
                const g = globalThis as unknown as {
                  document: any;
                  window: any;
                  getComputedStyle: (el: any) => any;
                };
                const overflow = Math.max(
                  0,
                  g.document.documentElement.scrollWidth - g.window.innerWidth
                );
                const els = Array.from(g.document.querySelectorAll('*')).slice(0, 600);
                let blurCount = 0;
                let translucentCount = 0;
                for (const el of els) {
                  const st = g.getComputedStyle(el);
                  const bf = String(st.backdropFilter || st.webkitBackdropFilter || '');
                  if (bf && bf !== 'none' && bf.includes('blur')) blurCount++;
                  const bg = String(st.backgroundColor || '');
                  const m = bg.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
                  if (m && parseFloat(m[1]!) > 0 && parseFloat(m[1]!) < 0.96) translucentCount++;
                }
                return {
                  overflow,
                  blurCount,
                  translucentCount,
                  draggableCount: g.document.querySelectorAll('[draggable="true"]').length,
                  buttonCount: g.document.querySelectorAll('button').length,
                  canvasCount: g.document.querySelectorAll('canvas').length,
                };
              });

              const actionResults: InspectWebUiResult['interactiveAudit']['actionResults'] = [];
              for (const act of args.actions ?? []) {
                const beforeSnap = await page.evaluate(
                  () => (globalThis as any).document.body?.innerText?.slice(0, 4000) ?? ''
                );
                try {
                  if (act.type === 'click' && act.selector) {
                    await page.click(act.selector, { timeout: 5000 });
                  } else if (act.type === 'fill' && act.selector) {
                    await page.fill(act.selector, act.value ?? '', { timeout: 5000 });
                  } else if (act.type === 'drag_and_drop' && act.selector && act.target_selector) {
                    await page.dragAndDrop(act.selector, act.target_selector, { timeout: 5000 });
                  } else if (act.type === 'wait_ms') {
                    await page.waitForTimeout(act.ms ?? 250);
                  } else if (act.type === 'eval_selector_text' && act.selector) {
                    const txt = await page.locator(act.selector).innerText({ timeout: 5000 });
                    actionResults.push({
                      action: act.type,
                      success: true,
                      stateChanged: false,
                      detail: txt.slice(0, 500),
                    });
                    continue;
                  }
                  await page.waitForTimeout(150);
                  const afterSnap = await page.evaluate(
                    () => (globalThis as any).document.body?.innerText?.slice(0, 4000) ?? ''
                  );
                  actionResults.push({
                    action: act.type,
                    success: true,
                    stateChanged: beforeSnap !== afterSnap,
                    detail: `selector=${act.selector ?? ''}`,
                  });
                } catch (actErr: unknown) {
                  actionResults.push({
                    action: act.type,
                    success: false,
                    stateChanged: false,
                    error: (actErr as Error).message,
                  });
                }
              }

              if (validatedScreenshotPath) {
                await page.screenshot({ path: validatedScreenshotPath, fullPage: true });
              }

              const glassWarnings: string[] = [];
              if (checkGlass && metrics.blurCount === 0) {
                glassWarnings.push(
                  'Live computed-style glassmorphism audit found 0 elements with `backdrop-filter: blur(...)`.'
                );
              }
              if (metrics.overflow > 0) {
                glassWarnings.push(
                  `Detected horizontal layout overflow of ${metrics.overflow}px.`
                );
              }

              return {
                url: urlCheck.parsed.toString(),
                mode: 'playwright_node',
                httpStatus: navRes?.status?.() ?? fetchRes.status,
                ok: consoleErrors.length === 0 && pageErrors.length === 0,
                title,
                horizontalOverflowPx: metrics.overflow,
                consoleErrors,
                pageErrors,
                failedRequests,
                glassmorphismAudit: {
                  checked: checkGlass,
                  backdropBlurElements: metrics.blurCount,
                  translucentSurfaces: metrics.translucentCount,
                  hasBackdropFilterCss: metrics.blurCount > 0,
                  warnings: glassWarnings,
                },
                interactiveAudit: {
                  draggableCount: metrics.draggableCount,
                  dragHandlerReferences: metrics.draggableCount,
                  buttonCount: metrics.buttonCount,
                  canvasCount: metrics.canvasCount,
                  actionResults,
                },
                screenshotPath: validatedScreenshotPath,
              };
            } finally {
              await browser.close().catch(() => undefined);
            }
          }
        }
      } catch {
        // Fall through to Python Playwright probe or static fallback
      }
    }

    const pyResult = await runPythonPlaywrightInspect(
      {
        url: urlCheck.parsed.toString(),
        viewport: args.viewport,
        actions: args.actions ?? [],
        screenshotPath: validatedScreenshotPath,
        timeoutMs,
      },
      timeoutMs
    );

    if (pyResult) {
      const glassWarnings: string[] = [];
      if (checkGlass && (pyResult.glassmorphismAudit?.backdropBlurElements ?? 0) === 0) {
        glassWarnings.push(
          'Live computed-style glassmorphism audit found 0 elements with `backdrop-filter: blur(...)`.'
        );
      }
      if ((pyResult.horizontalOverflowPx ?? 0) > 0) {
        glassWarnings.push(
          `Detected horizontal layout overflow of ${pyResult.horizontalOverflowPx}px.`
        );
      }
      return {
        url: urlCheck.parsed.toString(),
        mode: 'playwright_python',
        httpStatus: pyResult.httpStatus ?? fetchRes.status,
        ok:
          (pyResult.consoleErrors?.length ?? 0) === 0 &&
          (pyResult.pageErrors?.length ?? 0) === 0,
        title: pyResult.title ?? '',
        horizontalOverflowPx: pyResult.horizontalOverflowPx ?? 0,
        consoleErrors: pyResult.consoleErrors ?? [],
        pageErrors: pyResult.pageErrors ?? [],
        failedRequests: pyResult.failedRequests ?? [],
        glassmorphismAudit: {
          checked: checkGlass,
          backdropBlurElements: pyResult.glassmorphismAudit?.backdropBlurElements ?? 0,
          translucentSurfaces: pyResult.glassmorphismAudit?.translucentSurfaces ?? 0,
          hasBackdropFilterCss: Boolean(pyResult.glassmorphismAudit?.hasBackdropFilterCss),
          warnings: glassWarnings,
        },
        interactiveAudit: pyResult.interactiveAudit ?? {
          draggableCount: 0,
          dragHandlerReferences: 0,
          buttonCount: 0,
          canvasCount: 0,
          actionResults: [],
        },
        screenshotPath: validatedScreenshotPath,
      };
    }
  }

  return await runStaticWebAudit(urlCheck.parsed, fetchRes.bodySnippet, fetchRes.status, checkGlass);
}

export const WEB_FETCH_TOOL: ToolDefinition = {
  name: 'web_fetch',
  description:
    'Fetches an HTTP/HTTPS endpoint on local loopback (localhost, 127.0.0.1, [::1]) to verify live web server routes, API responses, status codes, and rendered HTML.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Target loopback HTTP URL (e.g. http://127.0.0.1:4173/index.html).' },
      method: { type: 'string', enum: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] },
      headers: { type: 'object', properties: {} },
      body: { type: 'string' },
      timeout_ms: { type: 'number', description: 'Request timeout in ms (default 15000).' },
    },
    required: ['url'],
  },
};

export const INSPECT_WEB_UI_TOOL: ToolDefinition = {
  name: 'inspect_web_ui',
  description:
    'Inspects a live loopback web page using headless Playwright (or static HTML/CSS fallback), auditing glassmorphism CSS (backdrop-filter blur & translucent surfaces), horizontal overflow, console/page errors, draggable elements, and interactive UI actions (click, fill, drag_and_drop) with before/after DOM state verification.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Loopback URL (e.g. http://127.0.0.1:4173/quantum-lab.html).' },
      viewport: {
        type: 'object',
        properties: {
          width: { type: 'number' },
          height: { type: 'number' },
        },
      },
      actions: {
        type: 'array',
        description: 'Optional sequence of UI interactions to execute and verify DOM changes.',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['click', 'fill', 'drag_and_drop', 'wait_ms', 'eval_selector_text'],
            },
            selector: { type: 'string' },
            target_selector: { type: 'string' },
            value: { type: 'string' },
            ms: { type: 'number' },
          },
          required: ['type'],
        },
      },
      check_glassmorphism: {
        type: 'boolean',
        description: 'Audit computed backdrop-filter and translucent surfaces (default true).',
      },
      screenshot_path: {
        type: 'string',
        description: 'Optional relative path inside project root to save full-page PNG screenshot.',
      },
      timeout_ms: { type: 'number' },
    },
    required: ['url'],
  },
};

export const WEB_TOOLS: ToolDefinition[] = [WEB_FETCH_TOOL, INSPECT_WEB_UI_TOOL];
