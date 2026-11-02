# Almudaya Multi-Agent v0.1.0 — Technical & Command Manual

Dokumentasi manual teknis resmi untuk executable CLI `almudaya`, mencakup sintaks perintah, opsi, format data, variabel lingkungan (*environment variables*), struktur penyimpanan Blackboard, penanganan error, dan mekanisme penguncian (*locking*).

---

## 1. Konsep Perintah Global & Opsi Umum

Format umum eksekusi CLI:
```bash
almudaya <command> <subcommand> [arguments...] [options...]
```

### Opsi Global
Opsi-opsi berikut didukung oleh seluruh perintah `almudaya`:

| Opsi | Tipe | Default | Keterangan |
|---|---|---|---|
| `-V, --version` | Flag | - | Menampilkan versi terpasang dari `almudaya-multiagent` (misal `0.1.0`). |
| `-h, --help` | Flag | - | Menampilkan bantuan manual perintah dan sub-perintah yang tersedia. |
| `--workspace <path>` | String | Platform default | Menimpa (*override*) direktori root penyimpanan session untuk eksekusi saat ini. |
| `--json` | Flag | `false` | Menghasilkan keluaran dalam format JSON murni terstruktur (ideal untuk scripting & piping). |

---

## 2. Referensi Lengkap Sub-Perintah CLI

### 2.1 Manajemen Session (`almudaya session`)

Mengelola siklus hidup ruang kolaborasi (*Session*).

#### A. Membuat Session Baru
```bash
almudaya session create <name> [options...]
```
- **Arguments:**
  - `<name>` *(Wajib)*: Nama deskriptif session (misal `my-project`).
- **Options:**
  - `--session <id>` *(Opsional)*: Slug ID session kustom (hanya huruf, angka, `-`, dan `_`, maks 64 karakter). Jika tidak diisi, ID otomatis di-*generate*.
  - `--description <text>` *(Opsional)*: Penjelasan tujuan session.
  - `--workspace <path>` *(Opsional)*: Tentukan folder root workspace.
  - `--json` *(Opsional)*: Output JSON.
- **Contoh:**
  ```bash
  almudaya session create "E-Commerce Refactoring" --session S001 --description "Refactoring core payment module"
  ```

#### B. Menampilkan Daftar Session
```bash
almudaya session list [options...]
```
- **Contoh:**
  ```bash
  almudaya session list
  almudaya session list --json
  ```

#### C. Memeriksa Rincian Session
```bash
almudaya session inspect --session <id> [options...]
```
- **Options:**
  - `--session <id>` *(Wajib)*: ID Session yang akan diperiksa.
- **Contoh:**
  ```bash
  almudaya session inspect --session S001
  ```

---

### 2.2 Manajemen Bot (`almudaya bot`)

Mengelola registrasi bot, penamaan, inspeksi status, dan siklus hidup proses *runtime*.

#### A. Mendaftarkan Bot ke Session (`join` / `start`)
```bash
almudaya bot join --session <id> [options...]
# atau alias: almudaya bot start --session <id> [options...]
```
- **Options:**
  - `--session <id>` *(Wajib)*: ID Session yang dituju.
  - `--bot <id>` *(Opsional)*: ID stabil bot (misal `BOT001`). Jika dikosongkan, sistem mengalokasikan ID otomatis (`BOT001`, `BOT002`, dst).
  - `--display-name <name>` *(Opsional)*: Nama tampilan manusiawi. Jika dikosongkan, otomatis menggunakan format default `<session>_<seq>`.
  - `--role <role>` *(Opsional)*: Peran bot (misal `"Architect"`, `"Coder"`, `"Reviewer"`).
  - `--description <desc>` *(Opsional)*: Deskripsi tugas spesifik bot.
- **Contoh:**
  ```bash
  almudaya bot join --session S001 --bot BOT001 --display-name "Architect" --role "System Architect"
  ```

#### B. Menampilkan Daftar Bot dalam Session
```bash
almudaya bot list --session <id> [options...]
```
Secara otomatis menjalankan rekonsiliasi liveness: bot dengan PID mati atau heartbeat kedaluwarsa akan ditandai berstatus `stale`.
- **Contoh:**
  ```bash
  almudaya bot list --session S001
  ```

#### C. Memeriksa Detail Bot Tertentu
```bash
almudaya bot inspect --session <id> --bot <id> [options...]
```
- **Contoh:**
  ```bash
  almudaya bot inspect --session S001 --bot BOT001
  ```

#### D. Mengubah Nama Tampilan Bot (`rename`)
```bash
almudaya bot rename --session <id> --bot <id> --new-name <name> [options...]
```
Mengubah `display_name` bot secara aman dengan menjamin keunikan nama baru. `bot_id` tetap permanen dan tidak merusak riwayat pesan lama.
- **Contoh:**
  ```bash
  almudaya bot rename --session S001 --bot BOT001 --new-name "Principal Architect"
  ```

#### E. Menjalankan Runtime Daemon Bot (`run`)
```bash
almudaya bot run --session <id> --bot <id> [options...]
```
Menjalankan loop proses bot independen di latar depan (*foreground*):
- Mencatat PID proses sistem operasi saat ini.
- Melakukan *heartbeat* periodik memperbarui `last_seen_at`.
- Memeriksa inbox pesan masuk secara berkala.
- Menangani sinyal terminasi (`SIGINT`/`SIGTERM`) untuk graceful shutdown (mengubah status menjadi `stopped`).
- **Options:**
  - `--interval <ms>` *(Opsional)*: Interval detak heartbeat dalam milidetik (default: `2000`).
  - `--no-auto-ack` *(Opsional)*: Nonaktifkan auto-acknowledgement pesan masuk.
- **Contoh:**
  ```bash
  almudaya bot run --session S001 --bot BOT001 --interval 3000
  ```

---

### 2.3 Komunikasi Broadcast (`almudaya broadcast`)

Publikasi dan konsumsi log event broadcast session yang bersifat *append-only* (`events.jsonl`).

#### A. Mempublikasikan Event Broadcast
```bash
almudaya broadcast publish --session <id> --bot <id> [options...]
```
- **Options:**
  - `--session <id>` *(Wajib)*: ID Session.
  - `--bot <id>` *(Wajib)*: ID bot pengirim.
  - `--category <cat>` *(Opsional)*: Kategori event (misal `ANNOUNCEMENT`, `TASK_ASSIGNED`, `DECISION`, `ALERT`; default: `ANNOUNCEMENT`).
  - `--payload <json_or_string>` *(Wajib)*: Data payload (string teks atau JSON valid).
- **Contoh:**
  ```bash
  almudaya broadcast publish --session S001 --bot BOT001 --category DECISION --payload '{"architecture": "event-driven", "db": "postgres"}'
  ```

#### B. Membaca Event Broadcast
```bash
almudaya broadcast read --session <id> --bot <id> [options...]
```
- **Options:**
  - `--session <id>` *(Wajib)*: ID Session.
  - `--bot <id>` *(Wajib)*: ID bot pembaca (digunakan untuk melacak posisi cursor).
  - `--category <cat>` *(Opsional)*: Filter event berdasarkan kategori tertentu.
  - `--limit <n>` *(Opsional)*: Batas jumlah event yang dibaca (default: `50`).
  - `--from-id <id>` *(Opsional)*: Mulai membaca event setelah ID event ini.
  - `--no-advance-cursor` *(Opsional)*: Baca tanpa memajukan posisi cursor bot.
- **Contoh:**
  ```bash
  almudaya broadcast read --session S001 --bot BOT002
  ```

---

### 2.4 Pesan Langsung / Direct Messaging (`almudaya message`)

Pertukaran pesan point-to-point antar-bot melalui Individual Blackboard (`inbox/<bot_id>/`).

#### A. Mengirim Pesan Langsung (`send`)
```bash
almudaya message send --session <id> --sender <id> --recipient <target> --body <text> [options...]
```
- **Options:**
  - `--session <id>` *(Wajib)*: ID Session.
  - `--sender <id>` *(Wajib)*: Bot ID pengirim.
  - `--recipient <target>` *(Wajib)*: Target penerima; **dapat berupa Bot ID stabil (misal `BOT001`) atau Display Name (misal `"Architect"`)**. Sistem akan me-resolve secara otomatis ke Bot ID penerima.
  - `--body <text>` *(Wajib)*: Isi pesan.
  - `--metadata <json>` *(Opsional)*: Metadata tambahan dalam format JSON.
- **Contoh:**
  ```bash
  almudaya message send --session S001 --sender BOT002 --recipient "Architect" --body "Dokumen arsitektur telah selesai saya telaah."
  ```

#### B. Membaca Pesan Masuk (`read`)
```bash
almudaya message read --session <id> --bot <id> [options...]
```
- **Options:**
  - `--session <id>` *(Wajib)*: ID Session.
  - `--bot <id>` *(Wajib)*: Bot ID pemilik inbox.
  - `--status <filter>` *(Opsional)*: Filter status pesan (`unread`, `read`, `acknowledged`, atau `all`; default: `unread`).
  - `--limit <n>` *(Opsional)*: Batas jumlah pesan (default: `20`).
- **Contoh:**
  ```bash
  almudaya message read --session S001 --bot BOT001
  almudaya message read --session S001 --bot BOT001 --status all --json
  ```

#### C. Mengonfirmasi Penerimaan Pesan (`ack`)
```bash
almudaya message ack --session <id> --bot <id> --message-id <msg_id> [options...]
```
Mengubah status pesan menjadi `acknowledged` secara idempotent (aman dipanggil berulang kali).
- **Contoh:**
  ```bash
  almudaya message ack --session S001 --bot BOT001 --message-id "msg_1730472000000_abc123"
  ```

---

### 2.5 Registri Konteks Bersama (`almudaya context`)

Menyimpan direktori project roots, variabel lingkungan dengan *automatic secret redaction*, dan katalog dokumen SDLC.

#### A. Project Roots (`almudaya context root`)
- **Menambahkan root:**
  ```bash
  almudaya context root add --session <id> --name <name> --path <path> [--type <primary|secondary|reference>]
  ```
  *(Path otomatis dinormalisasi menjadi path absolut)*.
- **Melihat daftar roots:**
  ```bash
  almudaya context root list --session <id>
  ```
- **Contoh:**
  ```bash
  almudaya context root add --session S001 --name backend --path "D:\Projects\ecom-api" --type primary
  almudaya context root list --session S001
  ```

#### B. Environment Metadata & Sanitasi Kredensial (`almudaya context env`)
- **Menyimpan key-value env:**
  ```bash
  almudaya context env set --session <id> --key <key> --value <value> [--description <desc>]
  ```
  > [!IMPORTANT]
  > Kunci yang mengandung kata sensitif (`KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `AUTH`, dll) atau nilai dengan pola token/kunci privat otomatis disanitasi dan disimpan sebagai `[REDACTED]`.
- **Melihat daftar env:**
  ```bash
  almudaya context env list --session <id>
  ```

#### C. Katalog Dokumen SDLC (`almudaya context doc`)
- **Mendaftarkan dokumen:**
  ```bash
  almudaya context doc add --session <id> --doc-id <id> --title <title> --doc-path <path> --type <type> [--doc-version <v>]
  ```
  *(Tipe dokumen: `REQUIREMENTS`, `ARCHITECTURE`, `DESIGN`, `TEST_PLAN`, `USER_MANUAL`, `RUNBOOK`, `OTHER`)*.
- **Melihat katalog dokumen:**
  ```bash
  almudaya context doc list --session <id> [--type <type>] [--status <status>]
  ```

---

## 3. Variabel Lingkungan (Environment Variables)

| Variabel | Keterangan | Nilai Standar |
|---|---|---|
| `ALMUDAYA_WORKSPACE` | Menentukan lokasi root folder penyimpanan Blackboard session. | Lihat tabel platform di bawah. |
| `ALMUDAYA_WORKSPACE_ROOT` | Alias alternatif untuk `ALMUDAYA_WORKSPACE`. | Sama dengan `ALMUDAYA_WORKSPACE`. |

### Lokasi Default Berdasarkan Sistem Operasi:
- **Windows:** `%LOCALAPPDATA%\almudaya` (misal: `C:\Users\<User>\AppData\Local\almudaya`)
- **macOS:** `~/Library/Application Support/almudaya`
- **Linux:** `$XDG_DATA_HOME/almudaya` atau `~/.local/share/almudaya`

Prioritas penentuan workspace:
1. Flag eksplisit `--workspace <path>`
2. Variabel `ALMUDAYA_WORKSPACE` / `ALMUDAYA_WORKSPACE_ROOT`
3. Direktori default sistem operasi

---

## 4. Layout Fisik Blackboard pada Filesystem

Setiap Session tersimpan dalam struktur folder terisolasi:

```text
<workspace_root>/
└── sessions/
    └── <session_id>/
        ├── session.json             # Metadata session, status, & timestamp
        ├── .lock                    # File lock kooperatif multi-proses
        ├── registry/
        │   └── bots.json            # Daftar bot terdaftar, PID, status liveness
        ├── broadcast/
        │   └── events.jsonl         # Log broadcast append-only (1 baris = 1 event)
        ├── inbox/
        │   ├── <bot_id_1>/
        │   │   ├── messages.json    # Daftar pesan masuk langsung
        │   │   └── cursors.json     # Catatan posisi baca broadcast
        │   └── <bot_id_2>/
        │       ├── messages.json
        │       └── cursors.json
        └── context/
            └── context.json         # Project roots, metadata env, referensi dokumen
```

Semua file JSON memiliki field `"schema_version": "0.1.0"` untuk memastikan kompatibilitas dan validasi saat proses deserialisasi.

---

## 5. Penanganan Error & Kode Exit

Aplikasi Almudaya menggunakan kode exit standar sistem operasi:
- `0`: Berhasil (Success).
- `1`: Terjadi kegagalan operasional / domain error.

### Hierarki Error Domain:
- `SessionNotFoundError`: Session yang diminta belum dibuat atau path tidak ditemukan.
- `BotNotFoundError` / `RecipientNotFoundError`: Bot target tidak ditemukan di dalam registri session.
- `DisplayNameConflictError`: Nama display yang diminta telah digunakan oleh bot lain di session yang sama.
- `ProjectRootAlreadyExistsError` / `DocumentAlreadyExistsError`: Duplikasi ID pada registri konteks bersama.
- `LockAcquisitionError` / `LockTimeoutError`: Terjadi perebutan akses tulis (*write contention*) yang melebihi batas toleransi waktu.
- `CorruptStorageError`: File JSON rusak atau tidak dapat di-parse secara valid.
