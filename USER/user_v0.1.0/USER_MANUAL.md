# Almudaya Multi-Agent v0.1.0 — Technical & Command Manual

Dokumentasi manual teknis resmi untuk executable CLI `almudaya`, mencakup sintaks perintah, opsi, parameter fleksibel, format data, variabel lingkungan (*environment variables*), struktur penyimpanan Blackboard, penanganan error, dan mekanisme penguncian (*locking*).

---

## 1. Konsep Perintah Global & Opsi Umum

Format umum eksekusi CLI:
```bash
almudaya <command> <subcommand> [arguments...] [options...]
```

Semua perintah dirancang fleksibel: dapat menerima **argumen posisi** (*positional arguments*) maupun **opsi berbendera** (*flags/options*).

### Opsi Global
Opsi-opsi berikut didukung oleh seluruh perintah `almudaya`:

| Opsi | Tipe | Default | Keterangan |
|---|---|---|---|
| `-v, --version` | Flag | - | Menampilkan versi terpasang dari `almudaya-multiagent` (misal `0.1.0`). |
| `-h, --help` | Flag | - | Menampilkan bantuan manual perintah dan sub-perintah yang tersedia. |
| `-w, --workspace <path>` | String | Platform default | Menimpa (*override*) direktori root penyimpanan session untuk eksekusi saat ini. |
| `--json` | Flag | `false` | Menghasilkan keluaran dalam format JSON murni terstruktur (ideal untuk scripting & piping). |

---

## 2. Referensi Lengkap Sub-Perintah CLI

### 2.1 Manajemen Session (`almudaya session`)

Mengelola siklus hidup ruang kolaborasi (*Session*).

#### A. Membuat Session Baru (`create`)
```bash
almudaya session create <name> [options...]
```
- **Arguments:**
  - `<name>` *(Wajib)*: Nama deskriptif session (misal `proyek-baru`).
- **Options:**
  - `-s, --session <id>` *(Opsional)*: Slug ID session kustom (misal `S002`). Hanya huruf, angka, `-`, dan `_`.
  - `--id <id>` *(Opsional)*: Alias untuk `--session <id>`.
  - `--description <text>` *(Opsional)*: Penjelasan tujuan session.
  - `-w, --workspace <path>` *(Opsional)*: Tentukan folder root workspace.
- **Contoh Penggunaan:**
  ```bash
  # Format paling populer dan direkomendasikan:
  almudaya session create proyek-baru --session S002

  # Dengan deskripsi tambahan:
  almudaya session create "E-Commerce App" --session S001 --description "Refactoring payment gateway"
  ```

#### B. Menampilkan Daftar Session (`list`)
```bash
almudaya session list [options...]
```
- **Contoh:**
  ```bash
  almudaya session list
  almudaya session list --json
  ```

#### C. Memeriksa Rincian Session (`inspect`)
```bash
almudaya session inspect [sessionId] [options...]
```
- **Options:**
  - `-s, --session <id>` *(Opsional jika sessionId diberikan di posisi argumen)*: ID Session yang akan diperiksa.
- **Contoh:**
  ```bash
  almudaya session inspect S002
  almudaya session inspect --session S002 --json
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
  - `-s, --session <id>` *(Wajib)*: ID Session yang dituju.
  - `-b, --bot <botId>` *(Opsional)*: ID stabil bot (misal `BOT001`). Jika dikosongkan, sistem mengalokasikan ID otomatis (`BOT001`, `BOT002`, dst).
  - `--display-name <name>` / `-n, --name <name>` *(Opsional)*: Nama tampilan manusiawi. Default: `<session>_<seq>`.
  - `--role <role>` / `-d, --description <desc>` *(Opsional)*: Peran atau deskripsi bot.
  - `-w, --workspace <path>` *(Opsional)*: Lokasi workspace.
- **Contoh:**
  ```bash
  almudaya bot join --session S002 --bot BOT001 --display-name "Architect" --role "System Architect"
  almudaya bot join --session S002 --bot BOT002 --display-name "Coder" --role "Software Engineer"
  ```

#### B. Menampilkan Daftar Bot dalam Session (`list`)
```bash
almudaya bot list --session <id> [options...]
```
> [!NOTE]
> Perintah `list` secara otomatis memindai liveness setiap bot di sistem operasi:
> - Bot dengan proses aktif yang rutin memompa heartbeat akan berstatus `(active)`.
> - Bot yang prosesnya sudah selesai atau dimatikan akan otomatis ditandai `(stale)`.

- **Contoh:**
  ```bash
  almudaya bot list --session S002
  almudaya bot list --session S002 --json
  ```

#### C. Memeriksa Detail Bot Tertentu (`inspect`)
```bash
almudaya bot inspect [botIdOrName] [options...]
```
- **Options:**
  - `-s, --session <id>` *(Wajib)*: ID Session.
  - `-b, --bot <botId>` *(Opsional jika nama/id diberikan di argumen)*.
- **Contoh:**
  ```bash
  almudaya bot inspect BOT001 --session S002
  almudaya bot inspect "Architect" --session S002
  ```

#### D. Mengubah Nama Tampilan Bot (`rename`)
```bash
almudaya bot rename [botId] [newDisplayName] [options...]
```
- **Options:**
  - `-s, --session <id>` *(Wajib)*: ID Session.
  - `-b, --bot <botId>`: Bot ID yang akan diganti namanya.
  - `-n, --new-name <name>`: Nama tampilan baru.
- **Contoh:**
  ```bash
  almudaya bot rename BOT001 "Lead Architect" --session S002
  almudaya bot rename --session S002 --bot BOT001 --new-name "Lead Architect"
  ```

#### E. Menjalankan Runtime Daemon Bot (`run`)
```bash
almudaya bot run --session <id> --bot <id> [options...]
```
Menjalankan loop bot interaktif di latar depan:
- Mencatat PID proses sistem operasi saat ini.
- Melakukan *heartbeat* otomatis memperbarui timestamp `last_seen_at`.
- Memantau inbox Blackboard dan langsung mencetak pesan masuk secara *real-time*.
- Otomatis melakukan *acknowledgement* (ack) pesan masuk.
- Menangani graceful shutdown saat ditekan `Ctrl+C`.
- **Options:**
  - `--interval <ms>`: Interval detak heartbeat dalam milidetik (default: `2000`).
  - `--no-auto-ack`: Matikan konfirmasi ack otomatis jika ingin mengonfirmasi manual.
- **Contoh:**
  ```bash
  almudaya bot run --session S002 --bot BOT001
  almudaya bot run --session S002 --bot BOT002 --interval 1000
  ```

---

### 2.3 Komunikasi Broadcast (`almudaya broadcast`)

Publikasi dan konsumsi log event broadcast session yang bersifat *append-only* (`events.jsonl`).

#### A. Mempublikasikan Event Broadcast (`publish`)
```bash
almudaya broadcast publish [content] [options...]
```
- **Options:**
  - `-s, --session <id>` *(Wajib)*: ID Session.
  - `-b, --bot <id>` / `--sender <id>` *(Opsional)*: Bot ID pengirim (default: `HUMAN`).
  - `--payload <content>` / `--content <content>` *(Opsional jika content ada di argumen)*: Isi event.
  - `-c, --category <cat>` *(Opsional)*: Kategori event (`ANNOUNCEMENT`, `DECISION`, `TASK`, `ALERT`; default: `ACTIVITY`).
- **Contoh:**
  ```bash
  almudaya broadcast publish --session S002 --bot BOT001 --category DECISION --payload '{"architecture": "Clean Architecture"}'
  almudaya broadcast publish "Server maintenance dimulai jam 14.00" --session S002
  ```

#### B. Membaca Event Broadcast (`read`)
```bash
almudaya broadcast read --session <id> [options...]
```
- **Options:**
  - `-s, --session <id>` *(Wajib)*: ID Session.
  - `-b, --bot <id>` *(Opsional)*: ID bot pembaca untuk melacak posisi kursor (cursor tracking).
  - `-c, --category <cat>` *(Opsional)*: Filter kategori event.
  - `-l, --limit <n>` *(Opsional)*: Batas jumlah event yang dibaca (default: `50`).
- **Contoh:**
  ```bash
  almudaya broadcast read --session S002 --bot BOT002
  ```

---

### 2.4 Pesan Langsung / Direct Messaging (`almudaya message`)

Pertukaran pesan point-to-point antar-bot melalui Individual Blackboard (`inbox/<bot_id>/`).

#### A. Mengirim Pesan Langsung (`send`)
```bash
almudaya message send [recipient] [content] [options...]
```
- **Options:**
  - `-s, --session <id>` *(Wajib)*: ID Session.
  - `-r, --recipient <target>`: Penerima pesan (**bisa berupa Bot ID `BOT001` atau Display Name `"Architect"`**).
  - `--body <text>` / `--content <text>`: Isi pesan teks.
  - `-b, --bot <id>` / `--sender <id>`: Bot ID pengirim (default: `HUMAN`).
  - `-t, --type <type>`: Tipe pesan (`DIRECT`, `REQUEST`, `RESPONSE`, `NOTIFICATION`; default: `DIRECT`).
- **Contoh:**
  ```bash
  # Menggunakan flags lengkap (sangat dianjurkan):
  almudaya message send --session S002 --sender BOT002 --recipient "Architect" --body "Halo Architect! Saya Coder, siap menerima instruksi rancangan."

  # Menggunakan sintaks posisi:
  almudaya message send "Architect" "Halo Architect!" --session S002 --sender BOT002
  ```

#### B. Membaca Pesan Masuk (`read`)
```bash
almudaya message read [botId] [options...]
```
- **Options:**
  - `-s, --session <id>` *(Wajib)*: ID Session.
  - `-b, --bot <botId>`: Bot ID pemilik inbox.
  - `--status <filter>`: Filter status pesan (`unread`, `read`, `acknowledged`, `all`; default: `unread`).
  - `-l, --limit <n>`: Batas jumlah pesan (default: `20`).
- **Contoh:**
  ```bash
  almudaya message read --session S002 --bot BOT001
  almudaya message read BOT001 --session S002 --status all --json
  ```

#### C. Mengonfirmasi Penerimaan Pesan (`ack`)
```bash
almudaya message ack [botId] [messageId] [options...]
```
- **Options:**
  - `-s, --session <id>` *(Wajib)*: ID Session.
  - `-b, --bot <botId>`: Bot ID pemilik inbox.
  - `-m, --message-id <id>`: ID pesan yang di-ack.
- **Contoh:**
  ```bash
  almudaya message ack --session S002 --bot BOT001 --message-id "msg_1730472000000_abc123"
  ```

---

### 2.5 Registri Konteks Bersama (`almudaya context`)

Menyimpan direktori project roots, variabel lingkungan dengan *automatic secret redaction*, dan katalog dokumen SDLC.

#### A. Project Roots (`almudaya context root`)
- **Menambahkan root:**
  ```bash
  almudaya context root add [name] [path] [options...]
  ```
  Options: `-n, --name <name>`, `-p, --path <path>`, `-t, --type <primary|dependency|reference|docs>`, `-s, --session <id>`.
- **Melihat daftar roots:**
  ```bash
  almudaya context root list --session <id>
  ```
- **Contoh:**
  ```bash
  almudaya context root add --session S002 --name testing --path D:\testingbot
  almudaya context root list --session S002
  ```

#### B. Environment Metadata & Sanitasi Kredensial (`almudaya context env`)
- **Menyimpan key-value:**
  ```bash
  almudaya context env set --session <id> --key <key> --value <value>
  # atau: almudaya context env set --session <id> --var KEY=VALUE
  ```
  > [!IMPORTANT]
  > Kunci yang mengandung kata sensitif (`KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `AUTH`, dll) atau nilai pola token otomatis disanitasi dan disimpan sebagai `[REDACTED]`.
- **Melihat metadata env:**
  ```bash
  almudaya context env show --session <id>
  ```

#### C. Katalog Dokumen SDLC (`almudaya context doc`)
- **Mendaftarkan dokumen:**
  ```bash
  almudaya context doc add [title] [path] [options...]
  ```
  Options: `--title <title>`, `--doc-path <path>`, `-t, --type <SRS|ARCHITECTURE|DESIGN|USER_GUIDE|OTHER>`, `--doc-version <v>`, `-s, --session <id>`.
- **Melihat dokumen:**
  ```bash
  almudaya context doc list --session <id>
  ```

---

## 3. Variabel Lingkungan & Lokasi Workspace

| Variabel | Keterangan | Nilai Standar |
|---|---|---|
| `ALMUDAYA_WORKSPACE` | Menentukan lokasi root folder penyimpanan Blackboard session. | Direktori AppData sistem. |
| `ALMUDAYA_WORKSPACE_ROOT` | Alias untuk `ALMUDAYA_WORKSPACE`. | Sama dengan `ALMUDAYA_WORKSPACE`. |

### Lokasi Default Sistem Operasi:
- **Windows:** `%LOCALAPPDATA%\almudaya` (misal: `C:\Users\<User>\AppData\Local\almudaya`)
- **macOS:** `~/Library/Application Support/almudaya`
- **Linux:** `$XDG_DATA_HOME/almudaya` atau `~/.local/share/almudaya`
