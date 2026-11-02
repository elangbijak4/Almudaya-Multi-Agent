# ADR-204: Autonomous ReAct Agent Loop and Blackboard Collaboration

- **Status:** APPROVED
- **Date:** 2026-11-02
- **Deciders:** Product Owner, Lead Architect
- **Consulted:** SRS v0.2.0 (FR-205, FR-216, FR-217, FR-218)
- **Resolves:** `OI-203`

---

## 1. Konteks & Masalah

Pada versi v0.1.0, callback `onMessage` di `BotRuntime` hanya bersifat pasif (mencetak teks ke layar). Untuk mewujudkan kolaborasi multi-agent di mana satu bot (misal "Architect") dapat memberikan tugas koding kepada bot lain (misal "Coder") dan bot penerima dapat menyelesaikannya secara mandiri, dibutuhkan **mesin loop otonom (ReAct Loop: Reason - Act - Observe)** yang mengendalikan interaksi bolak-balik antara LLM, tools eksekusi, dan Blackboard.

Isu terbuka `OI-203` mempertanyakan bagaimana dan di mana jejak audit eksekusi perkakas AI disimpan di Blackboard.

---

## 2. Keputusan yang Diambil

1. **Struktur Autonomous Agent Loop (`src/bot/agent-loop.ts`):**
   Loop otonom bekerja dengan siklus terstruktur:
   - **Langkah 1 (Input Parsing):** Pesan masuk dari inbox diambil. Sistem mengumpulkan identitas bot, peran, daftar peer bot, dan project roots aktif untuk membentuk System Prompt dinamis.
   - **Langkah 2 (Thinking / Reason):** Memanggil `IAIModelProvider.generateResponse()` dengan menyertakan definisi tools yang tersedia.
   - **Langkah 3 (Action / Act):** Jika model menghasilkan `toolCalls`:
     - Memeriksa mode keamanan (`REQUEST_REVIEW` vs `TURBO`).
     - Jika lolos persetujuan, menjalankan tool di dalam sandbox.
     - Menangkap hasil eksekusi tool (*Tool Result*).
   - **Langkah 4 (Observation):** Menambahkan Tool Result ke dalam riwayat percakapan inferensi, lalu memanggil kembali model LLM untuk melanjutkan penalaran.
   - **Langkah 5 (Batas Siklus / Bounded Loop):** Siklus tool dibatasi maksimal 10 iterasi per pesan untuk mencegah infinite loop jika LLM mengalami kebingungan.
   - **Langkah 6 (Final Reply & Blackboard Communication):** Begitu LLM menghasilkan teks jawaban akhir:
     - Sistem secara otomatis mengirim pesan balasan langsung ke inbox bot pengirim melalui `MessagingService.sendDirectMessage()`.

2. **Penyimpanan Jejak Audit (Resolusi `OI-203`):**
   - Seluruh pemanggilan tool yang berhasil atau ditolak, perubahan file, dan ringkasan tindakan dicatat langsung ke **`broadcast/events.jsonl`** di Session Blackboard menggunakan kategori yang sudah ada (`ACTIVITY` untuk mutasi berkas/shell, dan `DECISION` untuk kesimpulan arsitektur).
   - *Alasan:* Menghindari pembuatan struktur folder baru (*no data silos*). Rekan-rekan bot lain dalam session yang sama dapat ikut mengamati aktivitas koding bot secara transparan melalui pembacaan kursor broadcast yang telah ada sejak v0.1.0.

3. **Integrasi ke `almudaya bot run`:**
   Perintah `almudaya bot run` diperluas dengan parameter AI:
   ```bash
   almudaya bot run --session <id> --bot <id> \
     --provider <gemini|mock> \
     --model <modelName> \
     --mode <review|turbo>
   ```

---

## 3. Konsekuensi

- **Positif:**
  - Bot mampu berkolaborasi secara dua arah tanpa keterlibatan manual manusia untuk menyalin-tempel teks antar-terminal.
  - Seluruh tindakan terekam secara persisten di Blackboard.
- **Negatif / Mitigasi:**
  - Token API LLM dapat terpakai banyak jika loop tool berputar berkali-kali. Mitigasi: Diterapkan batas maksimal 10 iterasi (*guardrail iteration cap*) dan opsi batas token per permintaan.
