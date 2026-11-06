# Rancangan Sistem (System Design) — Almudaya Multi-Agent v0.3.1

**Versi Target:** 0.3.1 (*Security, Concurrency & Reliability Patch*)  
**Paket:** `almudaya-multiagent`  
**Status:** DRAFT (Approved for Implementation Baseline)  
**Tanggal:** 2026-11-06  

Dokumen ini mendefinisikan rancangan teknis terperinci, struktur tipe, algoritma, dan tanda tangan fungsi untuk rilis v0.3.1.

---

## 1. Peta Modul yang Terdampak

```
src/
├── ai/
│   ├── gemini.ts              <-- [Ubah] Tambahkan RateLimitPauseError, parseRetryDelay, dan jeda adaptif
│   └── provider.ts            <-- [Ubah] Ekspor kelas RateLimitPauseError generik
├── bot/
│   ├── agent-loop.ts          <-- [Ubah] Polling transaksional (mark-after-success) & penanganan RateLimitPause
│   └── console.ts             <-- [Ubah] Rendering notifikasi jeda kuota 429 yang ramah
├── cli/
│   └── commands/
│       └── messaging.ts       <-- [Ubah] Dukungan flag --no-mark-read pada message read
├── messaging/
│   └── service.ts             <-- [Ubah] Session lock pada readBroadcasts & koreksi pemfilteran kursor
└── tools/
    └── sandbox.ts             <-- [Ubah] Sanitasi environment (allowlist) & resolusi fs.realpathSync
```

---

## 2. Rincian Desain Komponen

### 2.1 Modul `src/tools/sandbox.ts` — Pengerasan Keamanan Sandbox & Shell

#### A. Sanitasi Variabel Lingkungan Subprocess (`sanitizeChildEnv`)
Fungsi pembantu murni untuk memfilter variabel lingkungan sebelum diteruskan ke `child_process.exec`:

```typescript
const SAFE_ENV_ALLOWLIST = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'LANG',
  'LC_ALL',
  'TERM',
  'NODE_ENV',
  'PYTHONPATH',
]);

const SENSITIVE_KEY_PATTERNS = [
  /KEY/i,
  /SECRET/i,
  /TOKEN/i,
  /AUTH/i,
  /PASSWORD/i,
  /PASSWD/i,
  /CREDENTIAL/i,
];

export function sanitizeChildEnv(rawEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const cleanEnv: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(rawEnv)) {
    if (!value) continue;

    // 1. Periksa apakah kunci berada dalam daftar allowlist aman
    const isAllowlisted = SAFE_ENV_ALLOWLIST.has(key.toUpperCase());

    // 2. Periksa apakah kunci memuat substring sensitif
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));

    if (isAllowlisted && !isSensitive) {
      cleanEnv[key] = value;
    }
  }

  return cleanEnv;
}
```

#### B. Resolusi Path Kanonikal Fisik (`assertWithinRoot`)
Memperbarui fungsi `assertWithinRoot` agar menyelesaikan seluruh tautan fisik (symlink dan Windows Junction) ke jalur nyata (*canonical physical path*):

```typescript
export function assertWithinRoot(targetPath: string, roots: ProjectRoot[]): string {
  const resolvedTarget = path.resolve(targetPath);
  
  // Selesaikan canonical path untuk targetPath jika sudah ada
  let canonicalTarget: string;
  try {
    canonicalTarget = fs.realpathSync(resolvedTarget);
  } catch {
    // Jika berkas belum ada (misal pada write_file baru), selesaikan direktori induknya
    const parentDir = path.dirname(resolvedTarget);
    try {
      const canonicalParent = fs.realpathSync(parentDir);
      canonicalTarget = path.join(canonicalParent, path.basename(resolvedTarget));
    } catch {
      canonicalTarget = resolvedTarget;
    }
  }

  // Verifikasi terhadap seluruh root yang terdaftar
  for (const root of roots) {
    let canonicalRoot: string;
    try {
      canonicalRoot = fs.realpathSync(path.resolve(root.path));
    } catch {
      canonicalRoot = path.resolve(root.path);
    }

    const relative = path.relative(canonicalRoot, canonicalTarget);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      return canonicalTarget;
    }
  }

  throw new SecurityError(
    `Access denied: Target path resolves to "${canonicalTarget}" which is outside registered project roots: [${roots.map((r) => r.path).join(', ')}]`
  );
}
```

---

### 2.2 Modul `src/ai/gemini.ts` — Ekstraksi `retryDelay` & Error Jeda Kuota

Mendefinisikan kelas error khusus `RateLimitPauseError` dan logika ekstraksi durasi jeda:

```typescript
export class RateLimitPauseError extends Error {
  constructor(
    message: string,
    public readonly retryDelaySeconds: number,
    public readonly originalError?: unknown
  ) {
    super(message);
    this.name = 'RateLimitPauseError';
  }
}

export function parseRetryDelay(errorObj: any): number | null {
  try {
    // 1. Ekstraksi dari format Google GenAI errorDetails (RetryInfo)
    if (errorObj?.errorDetails) {
      for (const detail of errorObj.errorDetails) {
        if (detail?.retryDelay) {
          const delayStr = String(detail.retryDelay).trim();
          const match = delayStr.match(/^([\d.]+)s?$/);
          if (match) {
            return parseFloat(match[1]);
          }
        }
      }
    }

    // 2. Ekstraksi dari teks pesan error bila ada pola "retry in 39.61s"
    const message = String(errorObj?.message || '');
    const textMatch = message.match(/retry in ([\d.]+)s/i) || message.match(/wait ([\d.]+)s/i);
    if (textMatch) {
      return parseFloat(textMatch[1]);
    }
  } catch {
    // Fallback bila parsing gagal
  }
  return null;
}
```

Di dalam fungsi `GeminiProvider.generateResponse`:
- Jika status kode bernilai `429` atau pesan memuat `RESOURCE_EXHAUSTED`:
  - Jalankan `parseRetryDelay(err)`.
  - Jika delay ditemukan (misal 39 detik), lempar `RateLimitPauseError("Gemini Rate Limit Exceeded", delaySeconds, err)`.
  - Jika tidak ditemukan, gunakan fallback jeda default 15 detik.

---

### 2.3 Modul `src/bot/agent-loop.ts` — Transaksional Message Processing & Rate Limit Latch

Memperbarui `pollCycle` dan `handleMessage`:

```typescript
// 1. Baca pesan TANPA menandai read terlebih dahulu
const unreadMessages = this.messagingService.readInbox(this.sessionId, this.botId, {
  markAsRead: false,
});

for (const msg of unreadMessages) {
  try {
    // 2. Jalankan ReAct turn
    await this.handleMessage(msg);

    // 3. HANYA setelah sukses, tandai sebagai read dan acknowledge
    this.messagingService.markMessagesAsRead(this.sessionId, this.botId, [msg.id]);
    if (this.autoAck) {
      this.messagingService.acknowledgeMessage(this.sessionId, this.botId, msg.id);
    }
  } catch (err) {
    if (err instanceof RateLimitPauseError) {
      // Tampilkan notifikasi ramah di konsol
      const delay = Math.ceil(err.retryDelaySeconds);
      this.consoleOutput?.(`⏳ Kuota Gemini tercapai (429 RESOURCE_EXHAUSTED). Menunggu jeda ${delay} detik sebelum mencoba kembali...`);
      
      // Jeda asinkron sebelum iterasi berikutnya (pesan tetap UNREAD di disk)
      await sleep((delay + 1) * 1000);
      break; // Hentikan siklus batch saat ini dan coba lagi di poll berikutnya
    } else {
      // Error tak terduga: catat error dan pertahankan pesan tetap unread untuk retry
      this.consoleOutput?.(`❗ Gagal memproses pesan "${msg.id}": ${(err as Error).message}. Pesan tetap disimpan di antrean.`);
      break;
    }
  }
}
```

---

### 2.4 Modul `src/messaging/service.ts` — Penguncian Kursor Broadcast

Memperbarui `readBroadcasts` agar pembaruan kursor dilindungi lock sesi dan tidak memajukan kursor melompati event yang terfilter:

```typescript
readBroadcasts(sessionId: string, options: ReadBroadcastOptions = {}): BroadcastEvent[] {
  return this.lockManager.withLock(sessionId, () => {
    const rawEvents = this.storage.readBroadcasts(sessionId);
    
    // Terapkan kursor hanya jika diminta
    let startIdx = 0;
    if (options.botId) {
      const cursor = this.getBroadcastCursor(sessionId, options.botId);
      if (cursor) {
        const found = rawEvents.findIndex((e) => e.event_id === cursor);
        if (found !== -1) startIdx = found + 1;
      }
    }

    const availableEvents = rawEvents.slice(startIdx);
    
    // Terapkan filter kategori jika ada
    let result = availableEvents;
    if (options.category) {
      result = result.filter((e) => e.category === options.category);
    }
    if (options.limit && options.limit > 0) {
      result = result.slice(0, options.limit);
    }

    // Majukan kursor HANYA ke event terakhir yang benar-benar dikonsumsi/disajikan
    if (options.botId && options.autoAdvanceCursor && result.length > 0) {
      const lastDeliveredEvent = result[result.length - 1];
      this.saveBroadcastCursor(sessionId, options.botId, lastDeliveredEvent.event_id);
    }

    return result;
  });
}
```

---

### 2.5 Modul `src/cli/commands/messaging.ts` — Opsi `--no-mark-read`

Menambahkan pendaftaran opsi eksplisit Commander:

```typescript
messageCommand
  .command('read')
  .description('Read incoming direct messages from inbox')
  .requiredOption('--session <id>', 'Session ID')
  .requiredOption('--bot <id>', 'Bot ID or display name')
  .option('--mark-read', 'Mark unread messages as read (default: true)', true)
  .option('--no-mark-read', 'Do not mark unread messages as read')
  .option('--json', 'Output in JSON format')
  .action(async (options) => {
    // options.markRead bernilai false jika --no-mark-read dipanggil
    ...
  });
```

---

## 3. Matriks Integritas & Verifikasi Desain

| Komponen | Proteksi yang Diberikan | Invarian Terkait |
|---|---|:---:|
| `sanitizeChildEnv` | Mencegah token kredensial terwariskan ke proses shell anak | **Invariant 7** |
| `assertWithinRoot` (realpath) | Memastikan symlink dan Windows Junction tidak dapat menembus keluar sandbox | **Invariant 5** |
| Transactional Inbox | Menjamin pesan tidak hilang jika terjadi crash atau abort | Reliabilitas Sistem |
| `RateLimitPauseError` | Mengganti persepsi "koneksi putus" dengan jeda adaptif resmi | Stabilitas Layanan |
| Atomic Broadcast Cursor | Menghilangkan hilangnya event broadcast akibat filter kategori | **Invariant 2** |
