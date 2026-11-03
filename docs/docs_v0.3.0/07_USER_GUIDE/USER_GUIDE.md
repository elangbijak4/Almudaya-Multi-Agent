# User Guide — Almudaya Multi-Agent v0.3.0
*Panduan Arsitektur & Orkestrasi Koding Multi-Root*

---

## 1. Filosofi & Arsitektur v0.3.0

### 1.1 Tantangan Multi-Agent Sebelumnya
Pada versi awal, setiap proses bot yang dijalankan memblokir (*freeze*) jendela terminalnya sendiri. Akibatnya, operator manusia yang mengontrol beberapa bot (misal: Architect, Coder, dan Tester) terpaksa membuka 4-5 terminal hanya untuk mengetik perintah kirim pesan. Selain itu, pada proyek yang memiliki banyak folder (misal `backend` dan `frontend`), aksi bot tidak memuat konteks folder yang jelas (*Cross-Root Blindness*).

### 1.2 Pendekatan "Satu Bot, Satu Terminal All-in-One"
Versi 0.3.0 mengubah terminal proses bot menjadi konsol interaktif penuh. Operator dapat mengontrol bot tersebut, berbicara langsung ke bot lokal, mengirim pesan ke bot lain, memantau rekan bot, dan melihat log kerja tanpa berpindah terminal.

```
+-------------------------------------------------------------------------+
|                  Terminal 1: Bot "Architect" (B001)                     |
| Architect> /peers                                                       |
| Architect> /roots                                                       |
| Architect> /msg Coder Buatkan REST server di backend                    |
| Architect> Rancang database PostgreSQL untuk session                    |
+-------------------------------------------------------------------------+
                                     |
               (Blackboard Messaging: broadcast & direct inboxes)
                                     |
+-------------------------------------------------------------------------+
|                    Terminal 2: Bot "Coder" (B002)                       |
| Coder> (Menerima pesan dari Architect -> ReAct Tool: write_file)         |
| Coder> (Otomatis mencatat aksi ke work_log.jsonl: [WRITE] root "backend")|
| Coder> /log                                                             |
+-------------------------------------------------------------------------+
                                     |
               (Shared Work Memory: sessions/<id>/work_log.jsonl)
                                     |
+-------------------------------------------------------------------------+
|                    Terminal 3: Bot "Tester" (B003)                      |
| Tester> (Membaca work_log via perkakas get_work_log)                    |
| Tester> (Mengetahui backend/src/api.js telah selesai)                   |
| Tester> (Menulis frontend/src/client.test.js & menjalankan tes)         |
+-------------------------------------------------------------------------+
```

---

## 2. Manajemen Direktori Multi-Root (Multi-Root Management)

Sebuah sesi kolaborasi Almudaya dapat mengelola beberapa root proyek sekaligus:
```bash
# Daftarkan root backend
almudaya context root register -s S001 --id backend --name "Backend API" --path ./backend --type primary

# Daftarkan root frontend
almudaya context root register -s S001 --id frontend --name "Frontend Web" --path ./frontend --type primary

# Daftarkan root dokumentasi
almudaya context root register -s S001 --id docs --name "System Documentation" --path ./docs --type docs
```

### Keamanan Sandbox Lintas-Root (Invariant 5)
Setiap perkakas berkas (`read_file`, `write_file`, `edit_file`, `list_dir`, `search_files`) dan perkakas shell (`run_command`) memeriksa path terhadap seluruh project roots terdaftar. Setiap upaya mengakses folder di luar daftar root akan langsung dibatalkan dengan galat keamanan `PathTraversalSecurityError`.

---

## 3. Memori Kerja Sesi Terpadu (Shared Session Work Memory)

### 3.1 Skema Catatan Kerja (`WorkLogEntry`)
Setiap mutasi berkas atau eksekusi perintah shell secara otomatis menghasilkan entri presisi di `sessions/<sessionId>/work_log.jsonl`:
```json
{
  "entry_id": "work_1762145892000_3a8f1b",
  "session_id": "S001",
  "timestamp": "2026-11-03T06:18:12.000Z",
  "bot_id": "B002",
  "bot_name": "Coder",
  "action_type": "WRITE",
  "target_root_id": "backend",
  "target_root_name": "Backend API",
  "target_root_path": "D:\\workspace\\backend",
  "relative_path": "src/api.js",
  "full_path": "D:\\workspace\\backend\\src\\api.js",
  "summary": "Wrote file src/api.js",
  "details": { "bytes": 348 }
}
```

### 3.2 Injeksi Otomatis ke System Prompt AI
Setiap kali bot AI hendak memproses pesan, sistem secara otomatis mengambil 10 baris riwayat kerja terakhir dan menyuntikkannya ke System Prompt AI:
```text
## Riwayat Kerja Terakhir di Sesi Ini (Shared Work Memory):
- [2026-11-03 13:10:01 UTC] Coder [WRITE] root "Backend API" (src/api.js): Wrote file src/api.js
- [2026-11-03 13:10:15 UTC] Coder [COMMAND] root "Backend API": Ran command: node --check src/api.js (exitCode: 0)
```
Hal ini memastikan model AI tidak bekerja "buta" (*zero blind spots*) dan secara langsung mengetahui perkembangan kerja rekan bot lain.

### 3.3 Perkakas AI `get_work_log`
Model AI juga dapat secara aktif menanyakan riwayat kerja spesifik saat merancang kode yang bergantung pada modul rekan lain:
- `get_work_log(root_id: "backend")`: Menanyakan semua pekerjaan yang telah dilakukan di root `backend`.
- `get_work_log(bot_id: "Coder")`: Menanyakan riwayat tindakan yang dilakukan oleh Coder.

---

## 4. Mode Keamanan Eksekusi: `review` vs `turbo`

| Fitur | Mode `REQUEST_REVIEW` (review) | Mode `TURBO` (turbo) |
|---|---|---|
| **Persetujuan Manusia** | **Wajib** sebelum menulis berkas atau menjalankan shell. | **Otonom**, langsung dieksekusi oleh model AI. |
| **Kasus Penggunaan** | Pengujian awal, lingkungan produksi, koding kritis. | Eksplorasi cepat, prototipe, refactoring otomatis terarah. |
| **Cara Mengubah** | Ketik `/mode review` di konsol aktif. | Ketik `/mode turbo` di konsol aktif. |
