# ADR-312: Transactional Inbox Lifecycle & Adaptive Rate Throttling Architecture

- **Status:** APPROVED
- **Date:** 2026-11-06
- **Deciders:** System Architect, Quality Auditor, Lead Developer
- **Consulted:** SRS v0.3.1 (FR-321, FR-322, FR-323, FR-324)
- **Resolves:** `RELIA-01` (Message loss on crash), `NT-05` (429 short retry), `NT-06` (Connection panic), `CONC-02` (Broadcast filter loss)

---

## 1. Konteks & Masalah

Hasil pengujian orkestrasi real-Gemini pada [`TESTING2.md`](file:///d:/almudaya_multiagent_v0.1.0/TESTING2.md) dan audit konkurensi pada [`AUDIT.md`](file:///d:/almudaya_multiagent_v0.1.0/AUDIT.md) mengungkap tiga tantangan reliabilitas kritis:

1. **`RELIA-01` (Pesan Hilang saat Abort/Crash):**
   Pada v0.3.0, `AutonomousAgentLoop` memanggil `readInbox(..., { markAsRead: true })` di awal polling. Jika turn eksekusi gagal di tengah jalan (misal crash proses, syntax error model, atau interupsi), pesan sudah berstatus `READ` dan tidak akan pernah diambil lagi, menyebabkan instruksi terbuang permanen.
2. **`NT-05` & `NT-06` (Penanganan Kuota 429 & Kepanikan Pengguna):**
   Model Gemini Free-Tier membatasi laju inferensi 5 RPM. Ketika kuota tercapai, server mengembalikan status HTTP 429 `RESOURCE_EXHAUSTED` disertai `retryDelay` ~39 detik. Namun provider saat ini hanya melakukan retry ~2 detik dan langsung menyerah dengan error fatal. Hal ini diperburuk oleh pesan error konsol `❗ Gagal memproses pesan...` yang membuat operator menyangka koneksi internet terputus, padahal server hanya meminta jeda tarif normal.
3. **`CONC-02` (Kursor Broadcast Membuang Event Terfilter):**
   Metode `readBroadcasts` memajukan kursor persisten bot ke event terakhir di berkas terlepas dari filter kategori. Hal ini menyebabkan event kategori lain yang berada sebelum kursor baru hilang permanen dari pembacaan berikutnya.

---

## 2. Keputusan yang Diambil

1. **Siklus Pemrosesan Pesan Transaksional (*Acknowledge-After-Success*):**
   - Polling antrean di `AutonomousAgentLoop` mengambil pesan dengan `{ markAsRead: false }`. Pesan tetap berstatus `unread` di disk Blackboard selama proses ReAct berlangsung.
   - Penandaan pesan sebagai `READ` dan `ACKNOWLEDGED` **hanya** dilakukan setelah seluruh siklus turn dan pemanggilan perkakas selesai dengan sukses.
   - Jika terjadi kegagalan atau proses dihentikan mendadak, pesan tetap utuh di kotak masuk dan akan otomatis diproses kembali pada iterasi berikutnya atau saat bot di-restart (*at-least-once delivery*).

2. **Deteksi Kuota & Jeda Adaptif (`RateLimitPauseError`):**
   - Modul `src/ai/gemini.ts` mem-parsing respons error Google API untuk mengekstrak field `retryDelay` dari `errorDetails` (misal `"39.61s"` -> 39610 ms).
   - Provider melempar kelas error terdedikasi: `RateLimitPauseError(message, retryDelaySeconds, originalError)`.
   - `AutonomousAgentLoop` menangkap error ini secara spesifik, menahan eksekusi selama durasi yang diminta server ditambah jeda pengaman (*jitter* 1 detik), lalu melakukan pengulangan inferensi secara mandiri.

3. **Notifikasi Konsol yang Informatif dan Menenangkan:**
   - Konsol bot mendeteksi status jeda kuota dan menampilkan pesan yang jelas dan ramah:
     `⏳ Kuota Gemini tercapai (429 RESOURCE_EXHAUSTED). Menunggu jeda ${delay} detik sebelum mencoba kembali...`
   - Menghilangkan persepsi bahwa jaringan internet terputus, memberikan visibilitas penuh kepada operator atas status pembatasan laju penyedia AI.

4. **Kursor Broadcast Atomik di Bawah Session Lock:**
   - Seluruh operasi pembacaan dan pembaruan kursor di `MessagingService.readBroadcasts` dibungkus dengan `this.lockManager.withLock(sessionId, ...)`.
   - Kursor bot hanya dimajukan ke ID event terakhir yang **benar-benar dikonsumsi/disajikan** kepada pemanggil, menjamin pembacaan dengan filter tidak membuang event yang belum dibaca.

---

## 3. Konsekuensi

- **Positif:**
  - Jaminan keandalan *at-least-once message processing*: instruksi antar-bot tidak akan pernah hilang akibat crash atau penundaan kuota.
  - Pengalaman pengguna orkestrasi real-Gemini menjadi sangat mulus: bot secara otomatis "menunggu" jendela kuota 5 RPM tanpa perlu disentuh (*nudge*) oleh operator.
  - Integritas linimasa broadcast terjamin bebas dari *race condition* dan kehilangan event terfilter.
- **Negatif / Mitigasi:**
  - *Potensi pengulangan pesan pada turn parsial (idempotensi):* Jika bot crash di akhir turn sebelum sempat menandai ack, pesan akan diproses ulang saat restart.
  - *Mitigasi:* Bot AI memiliki kesadaran konteks melalui work log dan riwayat berkas, serta perkakas koding file sudah memiliki guard proteksi overwrite/edit yang aman.
