# Software Requirements Specification (SRS) — Almudaya Multi-Agent v0.3.0

**Versi Target:** 0.3.0  
**Paket:** `almudaya-multiagent`  
**Status:** DRAFT (Approved for Requirements Baseline)  
**Tanggal:** 2026-11-03  

Dokumen ini mendefinisikan kebutuhan fungsional dan non-fungsional untuk Almudaya Multi-Agent Versi 0.3.0 (*The Interactive Bot Console & Cross-Root Orchestration Engine*).

---

## 1. Pendahuluan

### 1.1 Tujuan
Menghadirkan antarmuka interaktif terpadu (*Interactive Bot Console REPL*) pada setiap terminal proses bot dan menyediakan memori kerja bersama sesi berbasis lokasi (*Cross-Root Location-Aware Work Memory*) guna mewujudkan orkestrasi koding multi-agent multi-root yang intuitif, transparan, dan efisien.

### 1.2 Ruang Lingkup
Mencakup perombakan subsistem runtime CLI `almudaya bot run` menjadi konsol REPL interaktif, implementasi subsistem penyimpanan dan penelusuran `work_log.jsonl`, injeksi memori kerja ke model AI, penambahan perkakas `get_work_log`, dan pengujian end-to-end multi-root.

---

## 2. Kebutuhan Fungsional (Functional Requirements)

### 2.1 Konsol Bot Interaktif All-in-One (Interactive Bot REPL)

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-301** | **Non-Blocking Interactive REPL:** Menjalankan `almudaya bot run` membuka antarmuka prompt interaktif berbasis nama bot (misal: `Architect> `) yang tidak memblokir input keyboard operator saat proses bot memompa heartbeat atau mendengarkan pesan masuk. | Must |
| **FR-302** | **Direct Message Command (`/msg`):** Operator dapat mengirim pesan langsung ke bot lain di dalam session menggunakan sintaks `/msg <targetBot> <pesan>` atau `/send <targetBot> <pesan>`. Sistem menyelesaikan display name atau Bot ID secara otomatis. | Must |
| **FR-303** | **Broadcast Command (`/broadcast`):** Operator dapat mempublikasikan pengumuman broadcast ke seluruh bot di dalam session menggunakan sintaks `/broadcast <pesan>` atau `/shout <pesan>`. | Must |
| **FR-304** | **Direct Natural Language Instruction:** Teks bahasa alami tanpa awalan garis miring (`/`) yang diketik oleh operator di konsol secara otomatis diperlakukan sebagai instruksi langsung dari operator ke bot lokal tersebut, memicu siklus penalaran ReAct AI mandiri. | Must |
| **FR-305** | **Peer Inspection Command (`/peers`):** Operator dapat melihat daftar seluruh rekan bot aktif dan stale di dalam session, lengkap dengan peran dan PID-nya. | Must |
| **FR-306** | **Roots Inspection Command (`/roots`):** Operator dapat melihat seluruh direktori kerja proyek (*project roots*) yang terdaftar dalam session beserta tipe dan path absolutnya. | Must |
| **FR-307** | **Dynamic Mode Switching (`/mode`):** Operator dapat beralih antara mode `REQUEST_REVIEW` dan `TURBO` secara langsung di dalam konsol aktif menggunakan perintah `/mode review` atau `/mode turbo`. | Must |
| **FR-308** | **Work Log Inspection Command (`/log`):** Operator dapat melihat linimasa riwayat kerja sesi terkini dari seluruh bot menggunakan perintah `/log [limit] [root]`. | Must |
| **FR-309** | **Terminal Control Commands:** Konsol mendukung perintah utilitas standar: `/help` (bantuan perintah), `/clear` (membersihkan layar), `/status` (memeriksa status bot dan konfigurasi AI), dan `/exit` atau `/quit` (menghentikan bot dan keluar). | Must |
| **FR-310** | **Non-Destructive Notification Rendering:** Notifikasi pesan masuk, broadcast dari bot lain, atau log eksekusi dicetak di atas garis prompt aktif tanpa merusak atau menghilangkan teks yang sedang diketik oleh operator. | Must |

---

### 2.2 Memori Kerja Sesi Berbasis Lokasi (Location-Aware Work Memory & Cross-Root Orchestration)

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-311** | **Structured Work Memory Storage:** Session Blackboard menyediakan berkas persisten `sessions/<sessionId>/work_log.jsonl` untuk merekam jejak aksi koding terpadu. | Must |
| **FR-312** | **Location-Aware Work Log Schema:** Setiap entri log (`WorkLogEntry`) memuat: `entry_id`, `timestamp`, `bot_id`, `bot_name`, `action_type` (`WRITE`, `EDIT`, `READ`, `COMMAND`, `DECISION`), `target_root_id`, `target_root_name`, `target_root_path`, `relative_path`, `summary`, dan `details`. | Must |
| **FR-313** | **Automatic Mutation Recording:** Setiap kali bot berhasil memanggil perkakas mutasi berkas (`write_file`, `edit_file`) atau eksekusi shell (`run_command`), sistem secara otomatis mencatat entri presisi ke `work_log.jsonl` tanpa perlu perintah manual. | Must |
| **FR-314** | **Dynamic Work Log Prompt Injection:** Generator System Prompt AI secara otomatis menginjeksikan ringkasan N aktivitas kerja sesi terakhir di seluruh root proyek agar model AI memiliki kesadaran konteks progres tim (*team situational awareness*). | Must |
| **FR-315** | **AI Tool `get_work_log`:** Sistem menyediakan perkakas function calling `get_work_log(limit?: number, root_id?: string, bot_id?: string)` agar bot AI dapat secara terprogram menanyakan riwayat kerja rekan sebelum mengambil keputusan koding lintas-folder. | Must |
| **FR-316** | **Cross-Root Multi-Target Sandboxing:** Perkakas koding file dan shell mendukung resolusi target root eksplisit (`root_id` atau path), memungkinkan bot bekerja leluasa di berbagai root proyek terdaftar (misal: `frontend`, `backend`, `docs`) dengan tetap mematuhi Invariant 5 (anti-traversal). | Must |

---

### 2.3 Kedaulatan Manusia & Penutupan Konsol

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-317** | **Inline Human-in-the-Loop Review:** Pada mode `REQUEST_REVIEW`, dialog konfirmasi persetujuan (`y/n/d`) muncul secara mulus di dalam konsol interaktif sebelum mutasi berkas atau eksekusi perintah shell dijalankan. | Must |
| **FR-318** | **Graceful Shutdown on Exit:** Mengeluarkan perintah `/exit`, `/quit`, atau menekan `Ctrl+C` secara otomatis mematikan interval heartbeat, memperbarui status bot di Blackboard menjadi `stopped`, dan menutup terminal secara bersih. | Must |

---

## 3. Kebutuhan Non-Fungsional (Non-Functional Requirements)

| ID | Kebutuhan |
|---|---|
| **NFR-301** | Seluruh implementasi konsol, parser perintah, dan mesin work log wajib menggunakan TypeScript *strict mode* tanpa error. |
| **NFR-302** | Pengujian unit dan integrasi konsol wajib dapat berjalan 100% offline menggunakan virtual streams (`Readable`/`Writable` TTY) dan `MockAIProvider`. |
| **NFR-303** | Kompatibilitas penuh di Windows (Command Prompt `cmd.exe` dan PowerShell), macOS Terminal, dan Linux Bash/Zsh. |
| **NFR-304** | Responsivitas input keyboard di konsol harus instan (latensi < 10 ms), tidak terhambat oleh proses polling Blackboard di latar belakang. |
| **NFR-305** | Penulisan ke `work_log.jsonl` harus bersifat atomik (*atomic line append*) dengan penguncian kooperatif untuk mencegah tabrakan ketika beberapa proses bot menulis secara bersamaan. |

---

## 4. Aturan Invariant yang Dipertahankan & Diperluas

1. **Invariant 1 (Session-Centric):** Seluruh log kerja, pesan, dan status konsol terisolasi di dalam folder session masing-masing.
2. **Invariant 2 (Stable Identity):** Display name dan Bot ID tetap konsisten di seluruh log kerja dan tampilan prompt konsol.
3. **Invariant 5 (Sandbox Boundary):** Operasi berkas dan shell pada multi-root tetap terkurung ketat pada daftar `project roots` yang sah.
4. **Invariant 6 (Review Sovereignty):** Mode `REQUEST_REVIEW` tetap menjamin tidak ada kode yang ditulis ke disk tanpa izin eksplisit manusia.
5. **Invariant 7 (Credential Privacy):** Kunci API tetap hanya hidup di memori proses lokal; tidak pernah dicatat ke `work_log.jsonl` atau Blackboard.
