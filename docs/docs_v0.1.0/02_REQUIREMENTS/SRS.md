# Software Requirements Specification (SRS)

**Version:** 0.1.0 baseline  
**Status:** DRAFT

## 1. Purpose

Menentukan kebutuhan perangkat lunak untuk fondasi Almudaya Multi-Agent v0.1.0.

## 2. Product perspective

Aplikasi Node.js berbasis CLI yang mengelola Session persisten dan beberapa proses bot independen. Setiap proses menggunakan layanan internal untuk mengakses Blackboard dan messaging.

## 3. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-001 | Sistem dapat membuat Session dengan ID stabil dan metadata persisten. | Must |
| FR-002 | Proses bot dapat bergabung ke Session yang telah ada. | Must |
| FR-003 | Sistem mendaftarkan setiap bot pada Session registry. | Must |
| FR-004 | Setiap bot memiliki Bot ID stabil yang berbeda dari display name. | Must |
| FR-005 | Sistem menghasilkan display name default berdasarkan nama Session dan urutan bot. | Must |
| FR-006 | Pengguna dapat menetapkan atau mengubah display name bot. | Must |
| FR-007 | Display name harus unik dalam satu Session atau konflik ditangani secara deterministik. | Must |
| FR-008 | Sistem dapat menemukan bot lain melalui registry. | Must |
| FR-009 | Sistem menyimpan status bot dan waktu bergabung. | Must |
| FR-010 | Sistem menyediakan broadcast log per Session. | Must |
| FR-011 | Bot dapat membaca broadcast yang tersedia. | Must |
| FR-012 | Setiap bot memiliki Individual Blackboard/inbox. | Must |
| FR-013 | Bot dapat mengirim direct message ke Bot ID lain. | Must |
| FR-014 | Pengguna/bot dapat membaca dan meng-acknowledge pesan. | Must |
| FR-015 | Pesan dan event memiliki ID unik dan timestamp. | Must |
| FR-016 | Sistem mempertahankan state setelah proses restart. | Must |
| FR-017 | Sistem dapat mendaftarkan beberapa project roots. | Must |
| FR-018 | Sistem dapat menyimpan metadata environment bersama. | Must |
| FR-019 | Sistem dapat mendaftarkan referensi dokumen SDLC. | Must |
| FR-020 | CLI menyediakan bantuan dan versi. | Must |
| FR-021 | CLI menyediakan perintah session dan bot yang terdokumentasi. | Must |
| FR-022 | Sistem mendukung workspace root yang dapat dikonfigurasi. | Should |
| FR-023 | Sistem menangani bot yang berhenti secara tidak normal tanpa merusak registry/message store. | Should |

## 4. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-001 | Kode menggunakan TypeScript strict mode. |
| NFR-002 | Sistem berjalan pada Windows, Linux, dan macOS dengan versi Node yang didukung. |
| NFR-003 | Penyimpanan persisten tahan terhadap proses berhenti dan restart normal. |
| NFR-004 | Operasi tulis multi-process tidak boleh diam-diam menghilangkan atau merusak data. |
| NFR-005 | Format data memiliki versi skema dan validasi saat dibaca. |
| NFR-006 | Core services dapat diuji tanpa CLI. |
| NFR-007 | Tidak ada API key atau secret yang ditulis ke Blackboard/log. |
| NFR-008 | Error harus dapat ditindaklanjuti dan tidak membocorkan secret. |
| NFR-009 | Dependensi runtime dijaga seminimal mungkin. |
| NFR-010 | Pengujian tidak bergantung pada kredensial atau LLM eksternal. |

## 5. Data and identity rules

- `session_id` mengidentifikasi Session.
- `bot_id` mengidentifikasi bot secara stabil.
- `display_name` adalah nama yang dapat diedit dan hanya unik dalam lingkup Session.
- Historical message references menggunakan `bot_id`, bukan display name.
- Timestamp disimpan dalam format ISO 8601 UTC.
- Semua record persisten memiliki `schema_version` bila relevan.
- Pesan/event memiliki ID unik yang tidak bergantung pada urutan file.

## 6. Error handling requirements

Sistem harus mendeteksi dan melaporkan setidaknya:
- Session tidak ditemukan.
- Bot ID sudah terdaftar.
- Display name bentrok.
- Target bot tidak ditemukan.
- Data persisten tidak valid.
- Workspace tidak dapat diakses.
- Pesan tidak valid.
- Lock timeout atau write conflict.
- CLI argument tidak valid.

## 7. Out of scope

LLM inference, provider credentials, MCP, RAG, vector DB, GUI, autonomous orchestration, marketplace, remote bot execution, cloud synchronization, and standalone SDK.
