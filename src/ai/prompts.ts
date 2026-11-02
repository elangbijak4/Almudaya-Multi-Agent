import type { BotRecord } from '../bot/schema.js';
import type { ProjectRootRecord } from '../shared/schema.js';

export interface PromptContext {
  sessionId: string;
  botId: string;
  displayName: string;
  role?: string;
  description?: string;
  peerBots?: BotRecord[];
  projectRoots?: ProjectRootRecord[];
  executionMode?: 'REQUEST_REVIEW' | 'TURBO';
}

/**
 * Builds a dynamic, comprehensive system prompt grounded in the current Session Blackboard state.
 */
export function buildDynamicSystemPrompt(context: PromptContext): string {
  const sections: string[] = [];

  // Identity & Persona
  sections.push(`Anda adalah "${context.displayName}" (Bot ID: ${context.botId}), bertindak sebagai ${context.role ?? 'Software Engineering Bot'} dalam kolaborasi multi-agent Almudaya.`);
  if (context.description) {
    sections.push(`Deskripsi tugas: ${context.description}`);
  }

  // Session Context
  sections.push(`\n## Lingkungan Kolaborasi (Session Blackboard)
- Session ID: ${context.sessionId}
- Mode Eksekusi Keamanan: ${context.executionMode ?? 'REQUEST_REVIEW'}`);

  // Registered Target Project Roots
  if (context.projectRoots && context.projectRoots.length > 0) {
    sections.push('\n## Target Direktori Proyek (Project Roots):');
    sections.push('Anda memiliki akses penuh untuk menganalisis, membaca, membuat, dan mengedit file di folder target berikut:');
    for (const root of context.projectRoots) {
      sections.push(`- [${root.root_id}] "${root.name}" (${root.root_type}): ${root.path}`);
      if (root.description) {
        sections.push(`  Keterangan: ${root.description}`);
      }
    }
  } else {
    sections.push('\n## Target Direktori Proyek: Belum ada root yang didaftarkan.');
  }

  // Peer Bots in Session
  if (context.peerBots && context.peerBots.length > 0) {
    const activePeers = context.peerBots.filter((b) => b.bot_id !== context.botId);
    if (activePeers.length > 0) {
      sections.push('\n## Rekan Bot Lain yang Aktif di Session:');
      for (const peer of activePeers) {
        sections.push(`- [${peer.bot_id}] "${peer.display_name}" (${peer.status}) — Peran: ${peer.description ?? 'Engineer'}`);
      }
      sections.push('Anda dapat saling berkoordinasi, meminta review, atau membagi tugas dengan rekan-rekan bot di atas.');
    }
  }

  // Guidelines for Tool Calling & Collaboration
  sections.push(`\n## Panduan Operasional & Koding:
1. Selalu telaah struktur berkas target proyek terlebih dahulu menggunakan perkakas file ('list_dir', 'read_file').
2. Jika diminta menulis kode, gunakan 'write_file' atau 'edit_file' dengan path relatif terhadap project root yang sah.
3. Selalu periksa hasil pekerjaan Anda sebelum melapor kembali ke rekan bot atau operator.
4. Jangan mencoba mengakses atau memanipulasi file di luar target project root yang terdaftar.
5. Bersikaplah kolaboratif, profesional, dan berikan penjelasan ringkas serta jelas.`);

  return sections.join('\n');
}
