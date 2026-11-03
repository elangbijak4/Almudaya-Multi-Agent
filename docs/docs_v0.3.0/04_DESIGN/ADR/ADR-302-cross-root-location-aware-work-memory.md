# ADR-302: Cross-Root Location-Aware Session Work Memory Architecture

- **Status:** APPROVED
- **Date:** 2026-11-03
- **Deciders:** Product Owner, Lead Architect
- **Consulted:** SRS v0.3.0 (FR-311 s/d FR-316, Invariant 5)
- **Resolves:** `OI-302` (Location-aware multi-root logging and query efficiency)

---

## 1. Konteks & Masalah

Proyek rekayasa perangkat lunak modern jarang sekali hanya terdiri dari satu direktori tunggal. Proyek biasanya memiliki beberapa root terdaftar:
- Root 1: `backend` (`D:\testingbot\backend`)
- Root 2: `frontend` (`D:\testingbot\frontend`)
- Root 3: `docs` (`D:\testingbot\docs`)

Pada versi sebelumnya, ketika Bot "Coder" membuat file `src/index.js`, sistem mencatat aksi tersebut tanpa konteks root yang jelas. Bot "Tester" atau Bot "Architect" yang membaca broadcast hanya mengetahui ada file `src/index.js` yang berubah, tetapi tidak tahu apakah itu di `frontend` atau `backend`. Akibatnya, orkestrasi lintas-folder menjadi rentan salah sasaran (*Cross-Root Blindness*).

Isu `OI-302` mempertanyakan format penyimpanan, mekanisme pemetaan root, dan cara bot AI menanyakan riwayat kerja rekan di multi-root secara efisien.

---

## 2. Keputusan yang Diambil

1. **Penyimpanan Terpadu `work_log.jsonl` di Blackboard:**
   - Disimpan di `sessions/<sessionId>/work_log.jsonl` menggunakan pola *append-only*.
   - Setiap entri dilindungi oleh penguncian file atomik (*kernel-atomic locking*).

2. **Skema Data Presisi Lokasi (`WorkLogEntry`):**
   Setiap entri memuat dimensi lokasi lengkap:
   ```typescript
   export interface WorkLogEntry {
     entry_id: string;
     session_id: string;
     timestamp: string;
     bot_id: string;
     bot_name: string;
     action_type: 'WRITE' | 'EDIT' | 'READ' | 'COMMAND' | 'DECISION';
     target_root_id: string;       // e.g. "backend"
     target_root_name: string;     // e.g. "Backend API"
     target_root_path: string;     // e.g. "D:\testingbot\backend"
     relative_path?: string;       // e.g. "src/index.js"
     full_path?: string;           // e.g. "D:\testingbot\backend\src\index.js"
     summary: string;              // Ringkasan manusiawi
     details?: Record<string, unknown>;
   }
   ```

3. **Pencatatan Otomatis pada Tool Execution:**
   - Setiap kali `executeWriteFile`, `executeEditFile`, atau `executeRunCommand` berhasil dieksekusi:
     - Sistem memetakan path berkas ke project root yang sesuai (`validateSandboxedPath`).
     - Sistem secara otomatis mencatat `WorkLogEntry` ke `work_log.jsonl`.
     - Tidak diperlukan kode tambahan di sisi model AI untuk mencatat log; pencatatan dijamin 100% oleh middleware engine.

4. **Injeksi Konteks ke System Prompt Dinamis:**
   - Modul `src/ai/prompts.ts` secara otomatis menyertakan 5-10 catatan kerja terakhir dari `work_log.jsonl` ke dalam System Prompt AI:
     ```text
     ## Riwayat Kerja Terakhir di Session:
     - [2026-11-03 11:20:01] Coder [WRITE] root "backend" (src/server.ts): Membuat REST server
     - [2026-11-03 11:20:30] Coder [COMMAND] root "backend": node tests/test.js (LULUS)
     ```

5. **Perkakas Baru AI `get_work_log`:**
   - Disediakan perkakas Function Calling `get_work_log(limit, root_id, bot_id)` agar model AI dapat secara aktif menelusuri riwayat kerja spesifik saat merancang dependensi lintas-folder.

---

## 3. Konsekuensi

- **Positif:**
  - Menghilangkan ambiguitas lokasi file pada proyek multi-root secara permanen.
  - Model AI memiliki kesadaran situasional tim (*team situational awareness*) yang kuat.
  - Bot penguji atau arsitek dapat memverifikasi pekerjaan rekan bot lain dengan presisi tinggi.
- **Negatif / Mitigasi:**
  - Berkas `work_log.jsonl` dapat membesar seiring waktu.
  - *Mitigasi:* Pembacaan default dibatasi maksimal 20-50 baris terakhir (*tail reading*) sehingga performa I/O tetap instan (< 5 ms).
