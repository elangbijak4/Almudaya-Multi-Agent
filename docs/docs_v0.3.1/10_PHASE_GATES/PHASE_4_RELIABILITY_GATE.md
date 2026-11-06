# Phase 4 Gate — Transactional Messaging & Rate-Limit Adaptation (v0.3.1)

## Required Deliverables

- **Implementasi Pemrosesan Pesan Transaksional (`RELIA-01` / FR-321):**
  - Modul [`src/messaging/service.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/messaging/service.ts):
    - Penambahan metode `markMessagesAsRead(sessionId, botIdentifier, messageIds)`.
  - Modul [`src/bot/runtime.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/bot/runtime.ts):
    - Pembacaan antrean pesan inbox menggunakan `markAsRead: false` pada `pollCycle()`.
    - Pesan **hanya** ditandai sebagai `read` dan `acknowledged` setelah fungsi `onMessageCallback(msg)` tuntas dieksekusi dengan sukses.
    - Kegagalan eksekusi mempertahankan status pesan tetap `unread` di disk Blackboard (*at-least-once delivery*).
  - Modul [`src/cli/commands/bot.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/cli/commands/bot.ts):
    - Callback `onMessage` meneruskan kegagalan (`throw err`) agar pesan yang gagal diproses tidak di-ack atau di-mark-read secara prematur.
- **Implementasi Penanganan Jeda Kuota Model Gemini 429 (`NT-05`, `NT-06` / FR-322, FR-323):**
  - Modul [`src/ai/provider.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/ai/provider.ts):
    - Definisi kelas error terdedikasi `RateLimitPauseError(message, retryDelaySeconds, cause)`.
  - Modul [`src/ai/gemini.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/ai/gemini.ts):
    - Implementasi `parseRetryDelay(err)` untuk mengekstrak field durasi `retryDelay` dari payload `errorDetails` (RetryInfo) atau pesan teks respons Gemini API.
    - Melempar `RateLimitPauseError` seketika bila server meminta jeda signifikan (> 5 detik) atau saat batas percobaan cepat habis.
  - Modul [`src/bot/agent-loop.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/bot/agent-loop.ts):
    - Penangkapan `RateLimitPauseError` di dalam loop iterasi ReAct.
    - Pemancaran notifikasi ramah melalui `onStatusCallback`: `⏳ Kuota Gemini tercapai (429 RESOURCE_EXHAUSTED). Menunggu jeda ${delay} detik sebelum mencoba kembali...`.
    - Jeda asinkron adaptif (`retryDelaySeconds + 1s` jitter) dan pengulangan giliran otonom (*autonomous turn retry*) tanpa menghanguskan kuota batas langkah iterasi.
- **Implementasi Atomisitas Kursor Broadcast (`CONC-02` / FR-324):**
  - Modul [`src/messaging/service.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/messaging/service.ts):
    - Metode `readBroadcasts` dibungkus sepenuhnya dalam penguncian sesi `this.storage.withSessionLock(sessionId, ...)`.
    - Pemfilteran kategori dievaluasi sebelum pembaruan kursor, dan kursor hanya dimajukan hingga ID event terakhir yang benar-benar dikonsumsi/disajikan kepada pemanggil.
- **Implementasi Opsi CLI `--no-mark-read` (`NT-01` / FR-325):**
  - Modul [`src/cli/commands/messaging.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/cli/commands/messaging.ts):
    - Pendaftaran opsi Commander `.option('--no-mark-read', 'Do not mark unread messages as read')`.
- **Suite Pengujian Unit & Integrasi Baru (12 Tes Baru):**
  - [`tests/messaging/transactional-inbox.test.ts`](file:///d:/almudaya_multiagent_v0.1.0/tests/messaging/transactional-inbox.test.ts): 3 tes verifikasi pesan unread saat crash/gagal, dan ack setelah sukses.
  - [`tests/ai/gemini-retry.test.ts`](file:///d:/almudaya_multiagent_v0.1.0/tests/ai/gemini-retry.test.ts): 6 tes parsing `retryDelay`, pembentukan `RateLimitPauseError`, dan jeda adaptif pada `AutonomousAgentLoop`.
  - [`tests/messaging/broadcast-cursor-atomic.test.ts`](file:///d:/almudaya_multiagent_v0.1.0/tests/messaging/broadcast-cursor-atomic.test.ts): 1 tes live pembuktian event tidak hilang saat membaca broadcast dengan filter kategori.
  - [`tests/cli/message-read-flag.test.ts`](file:///d:/almudaya_multiagent_v0.1.0/tests/cli/message-read-flag.test.ts): 2 tes pembacaan kotak masuk CLI dengan dan tanpa opsi `--no-mark-read`.

---

## Exit Criteria Checklist

- [x] Pesan inbox yang mengalami kegagalan proses di tengah jalan tetap berstatus `unread` dan tidak hilang (RELIA-01 / FR-321).
- [x] Respon error 429 memicu `RateLimitPauseError` dengan parsing delay server yang presisi, jeda otomatis, dan status informatif di konsol (NT-05, NT-06 / FR-322, FR-323).
- [x] Kursor broadcast tersimpan atomik di bawah session lock tanpa menghilangkan event berikutnya saat pemanggilan berfilter (CONC-02 / FR-324).
- [x] Opsi CLI `message read --no-mark-read` berfungsi mulus tanpa error Commander (NT-01 / FR-325).
- [x] Seluruh 201 pengujian pada 37 berkas lulus 100% secara offline.
- [x] Kompilasi TypeScript (`npm run build`) bersih tanpa error tipe.

---

## Gate Decision

- **Hasil:** **PASSED**
- **Evidence:** Seluruh kriteria Fase 4 terpenuhi; 201 tes pada 37 berkas lulus 100% dalam ~4.4 detik.
- **Rekomendasi:** Melangkah ke **Phase 5: Console UX & CLI Consistency Updates** (`README.md`, `USER_MANUAL.md`, dan sinkronisasi enum kategori broadcast).
- **Tanggal:** 2026-11-06
