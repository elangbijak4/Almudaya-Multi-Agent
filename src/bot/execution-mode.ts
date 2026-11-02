import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export type ExecutionMode = 'REQUEST_REVIEW' | 'TURBO';

export interface ToolExecutionRequest {
  toolName: string;
  args: Record<string, unknown>;
  botName?: string;
  botId?: string;
}

export interface ExecutionApprovalDecision {
  approved: boolean;
  reason?: string;
}

export type InteractivePromptHandler = (
  message: string
) => Promise<string>;

/**
 * Mutating tools that require human approval in REQUEST_REVIEW mode.
 * Read-only inspection tools (read_file, list_dir, search_files) execute safely without prompt.
 */
const MUTATING_TOOLS = new Set(['write_file', 'edit_file', 'run_command']);

/**
 * Controller enforcing safety boundaries and Human-in-the-Loop approval
 * according to ADR-203 and Invariant 6 (Review Sovereignty).
 */
export class ExecutionModeController {
  private mode: ExecutionMode;
  private promptHandler?: InteractivePromptHandler;

  constructor(
    initialMode: ExecutionMode = 'REQUEST_REVIEW',
    customPromptHandler?: InteractivePromptHandler
  ) {
    this.mode = initialMode;
    this.promptHandler = customPromptHandler;
  }

  public getMode(): ExecutionMode {
    return this.mode;
  }

  public setMode(mode: ExecutionMode): void {
    this.mode = mode;
  }

  /**
   * Sets a custom prompt handler (useful for headless testing or custom UI).
   */
  public setPromptHandler(handler?: InteractivePromptHandler): void {
    this.promptHandler = handler;
  }

  /**
   * Checks whether the tool invocation requires review under current mode.
   */
  public isReviewRequired(toolName: string): boolean {
    if (this.mode === 'TURBO') {
      return false;
    }
    return MUTATING_TOOLS.has(toolName);
  }

  /**
   * Evaluates tool call. In TURBO mode, automatically approved.
   * In REQUEST_REVIEW mode, prompts the human operator via terminal.
   */
  public async requestApproval(
    request: ToolExecutionRequest
  ): Promise<ExecutionApprovalDecision> {
    if (!this.isReviewRequired(request.toolName)) {
      return { approved: true };
    }

    const botIdentity = request.botName
      ? `Bot "${request.botName}" (${request.botId ?? 'unknown'})`
      : `Bot ${request.botId ?? 'AI'}`;

    const promptText = this.formatReviewPrompt(botIdentity, request);

    // If custom handler is supplied (e.g. unit tests or automated runner)
    if (this.promptHandler) {
      const answer = (await this.promptHandler(promptText)).trim().toLowerCase();
      if (answer === 'y' || answer === 'yes') {
        return { approved: true };
      }
      return {
        approved: false,
        reason: 'Operator rejected the action via prompt handler.'
      };
    }

    // Interactive CLI terminal fallback
    const rl = readline.createInterface({ input, output });
    try {
      while (true) {
        const answer = (
          await rl.question(
            `${promptText}\nApakah Anda menyetujui aksi ini? [y = Setuju, n = Tolak, d = Lihat Detail] (y/n/d): `
          )
        )
          .trim()
          .toLowerCase();

        if (answer === 'y' || answer === 'yes') {
          return { approved: true };
        }

        if (answer === 'n' || answer === 'no') {
          return {
            approved: false,
            reason: 'Aksi ditolak oleh operator (Human-in-the-Loop review rejected).'
          };
        }

        if (answer === 'd' || answer === 'detail') {
          output.write(
            `\n--- DETAIL PARAMETER PANGGILAN TOOL ---\n${JSON.stringify(request.args, null, 2)}\n----------------------------------------\n\n`
          );
          continue;
        }

        output.write('Pilihan tidak valid. Silakan ketik y, n, atau d.\n');
      }
    } finally {
      rl.close();
    }
  }

  private formatReviewPrompt(
    botIdentity: string,
    request: ToolExecutionRequest
  ): string {
    const lines: string[] = [
      `\n⚠️  [REVIEW REQUIRED] ${botIdentity} meminta izin eksekusi:`,
      `  Aksi: ${request.toolName}`
    ];

    if (request.toolName === 'write_file') {
      const p = String(request.args['path'] ?? '');
      const content = String(request.args['content'] ?? '');
      lines.push(`  Berkas Target: ${p}`);
      lines.push(`  Ukuran Teks:   ${content.length} karakter (~${content.split('\n').length} baris)`);
      if (request.args['overwrite']) {
        lines.push(`  Mode:          Overwrite (menimpa berkas jika sudah ada)`);
      }
    } else if (request.toolName === 'edit_file') {
      const p = String(request.args['path'] ?? '');
      lines.push(`  Berkas Target: ${p}`);
      lines.push(`  Blok Target:   "${String(request.args['target'] ?? '').slice(0, 80)}"`);
      lines.push(`  Pengganti:     "${String(request.args['replacement'] ?? '').slice(0, 80)}"`);
    } else if (request.toolName === 'run_command') {
      lines.push(`  Perintah Shell: "${String(request.args['command'] ?? '')}"`);
      if (request.args['working_dir']) {
        lines.push(`  Direktori:      ${String(request.args['working_dir'])}`);
      }
      if (request.args['timeout_ms']) {
        lines.push(`  Batas Waktu:    ${String(request.args['timeout_ms'])} ms`);
      }
    }

    return lines.join('\n');
  }
}
