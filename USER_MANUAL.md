# Almudaya Multi-Agent v0.2.0 — Technical & Command Manual

Dokumentasi manual teknis resmi untuk executable CLI `almudaya`, mencakup sintaks perintah, opsi, parameter fleksibel, format data, variabel lingkungan (*environment variables*), struktur penyimpanan Blackboard, penanganan error, mekanisme penguncian (*locking*), arsitektur AI multi-provider, perkakas koding otonom (*sandboxed file & shell tools*), dan mode keamanan eksekusi (*Request Review vs Turbo*).

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
Menjalankan loop bot runtime di terminal dengan kapabilitas penalaran AI otonom (*Autonomous Agent Loop*):
- Mencatat PID proses sistem operasi saat ini.
- Melakukan *heartbeat* otomatis memperbarui timestamp `last_seen_at`.
- Memantau inbox Blackboard dan langsung mencetak pesan masuk secara *real-time*.
- Otomatis mengalirkan pesan masuk ke model AI yang dipilih untuk penalaran ReAct mandiri.
- Mengeksekusi perkakas koding (`read_file`, `write_file`, `edit_file`, `list_dir`, `search_files`, `run_command`) di dalam sandbox target project root.
- Menerapkan mode keamanan eksekusi (`REQUEST_REVIEW` dengan konfirmasi manusia vs `TURBO` otonom).
- Otomatis mengirimkan balasan langsung (*direct message*) ke bot pengirim setelah tugas selesai.
- Otomatis mencatat seluruh jejak audit ke Session Blackboard (`events.jsonl`).
- Otomatis melakukan *acknowledgement* (ack) pesan masuk.
- Menangani graceful shutdown saat ditekan `Ctrl+C`.
- **Options:**
  - `--provider <gemini|mock>`: Provider AI untuk bot ini (default: otomatis menggunakan `gemini` jika `GEMINI_API_KEY` terdeteksi, atau `mock` jika offline).
  - `--model <modelName>`: Nama model LLM spesifik (default: `gemini-2.5-flash`).
  - `-m, --mode <review|turbo>`: Mode keamanan eksekusi (default: `review`).
    - `review`: Menahan mutasi berkas dan shell command hingga operator menyetujui (`y/n/d`).
    - `turbo`: Menjalankan seluruh perkakas secara mandiri tanpa konfirmasi per langkah.
  - `--max-iterations <count>`: Batas maksimal perulangan ReAct loop per pesan (default: `10`).
  - `--interval <ms>`: Interval detak heartbeat dalam milidetik (default: `2000`).
  - `--no-auto-ack`: Matikan konfirmasi ack otomatis jika ingin mengonfirmasi manual.
- **Contoh:**
  ```bash
  # Menjalankan bot Coder dengan Gemini AI di mode TURBO otonom:
  almudaya bot run --session S002 --bot BOT002 --provider gemini --mode turbo

  # Menjalankan bot Coder dengan Gemini AI di mode REQUEST_REVIEW (Human-in-the-Loop):
  almudaya bot run --session S002 --bot BOT002 --provider gemini --mode review

  # Menjalankan bot Architect untuk monitoring & koordinasi:
  almudaya bot run --session S002 --bot BOT001
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
  - `-c, --category <cat>` *(Opsional)*: Kategori event (`ACTIVITY`, `OBSERVATION`, `DECISION`, `TASK`, `ARTIFACT`, `QUESTION`, `STATUS`, `ALERT`; default: `ACTIVITY`).
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
  - `-l, --limit <n>` *(Opsional)*: Batas jumlah event yang dibaca.
  - `--json`: Format keluaran dalam JSON.
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
  - `-b, --bot <botId>`: Bot ID pemilik inbox (dapat diberikan sebagai argumen posisi atau opsi `-b`).
  - `--mark-read`: Tandai pesan `unread` sebagai dibaca (default: true).
  - `--no-mark-read`: Membaca pesan tanpa mengubah status pesan `unread` menjadi `read`.
  - `-l, --limit <n>`: Batas jumlah pesan yang dibaca.
  - `--json`: Format keluaran dalam JSON.
- **Contoh:**
  ```bash
  almudaya message read --session S002 --bot BOT001
  almudaya message read BOT001 --session S002 --no-mark-read
  almudaya message read BOT001 --session S002 --json
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
| `GEMINI_API_KEY` | Kunci API Google Gemini untuk mengaktifkan penalaran LLM pada bot. Disimpan murni dalam memori proses lokal (*Invariant 7*). | - |
| `ALMUDAYA_WORKSPACE` | Menentukan lokasi root folder penyimpanan Blackboard session. | Direktori AppData sistem. |
| `ALMUDAYA_WORKSPACE_ROOT` | Alias untuk `ALMUDAYA_WORKSPACE`. | Sama dengan `ALMUDAYA_WORKSPACE`. |

### Lokasi Default Sistem Operasi:
- **Windows:** `%LOCALAPPDATA%\almudaya` (misal: `C:\Users\<User>\AppData\Local\almudaya`)
- **macOS:** `~/Library/Application Support/almudaya`
- **Linux:** `$XDG_DATA_HOME/almudaya` atau `~/.local/share/almudaya`

---

## 4. Mesin Perkakas Koding Otonom (Autonomous Tools)

Setiap bot yang dijalankan dengan provider AI aktif (`--provider gemini` atau `--provider mock`) memiliki akses ke 6 perkakas koding standar yang bekerja di dalam batasan sandbox project root:

### A. `read_file`
Membaca konten berkas teks secara aman.
- `path` (string, wajib): Path relatif terhadap project root.
- `start_line` (number, opsional): Baris awal (1-indexed).
- `end_line` (number, opsional): Baris akhir (1-indexed).
- *Proteksi:* Maksimal ukuran berkas 10 MB untuk mencegah crash akibat membaca file biner raksasa (*NFR-204*).

### B. `write_file`
Menulis atau menimpa berkas teks secara atomik.
- `path` (string, wajib): Path relatif berkas target.
- `content` (string, wajib): Teks lengkap yang akan ditulis.
- `overwrite` (boolean, opsional): Jika `false` (default) dan file sudah ada, sistem menolak operasi untuk mencegah penimpaan tak disengaja.
- *Atomisitas:* Menggunakan file sementara `.tmp` dan rename atomik guna mencegah berkas rusak akibat kegagalan daya/proses tengah jalan (*ADR-202*). Folder induk dibuat otomatis (*mkdir -p*).

### C. `edit_file`
Melakukan penggantian potongan blok teks eksak secara presisi.
- `path` (string, wajib): Path relatif berkas.
- `target` (string, wajib): Potongan teks eksak yang akan dicari dan diganti (memperhatikan indentasi dan baris baru).
- `replacement` (string, wajib): Teks baru pengganti.

### D. `list_dir`
Menjelajahi struktur pohon folder direktori target.
- `path` (string, opsional): Sub-folder yang akan diinspeksi (default: root `.`).
- `recursive` (boolean, opsional): Menjelajah seluruh sub-folder secara rekursif (default: `false`).
- *Filter Otomatis:* Folder bising seperti `.git`, `node_modules`, dan `.almudaya` otomatis diabaikan.

### E. `search_files`
Mencari berkas berdasarkan pola nama atau isi teks.
- `pattern` (string, wajib): Kata kunci atau substring yang dicari.
- `path` (string, opsional): Direktori pencarian (default: root `.`).

### F. `run_command`
Mengeksekusi perintah shell/sistem operasi di dalam direktori project root.
- `command` (string, wajib): Perintah shell lengkap (misal: `npm test`, `git status`, `python main.py`).
- `timeout_ms` (number, opsional): Batas waktu eksekusi dalam milidetik (default: `30000`).
- `working_dir` (string, opsional): Sub-direktori kerja di dalam project root.
- *Proteksi:* Menangkap stdout, stderr, kode keluar, serta melakukan *process tree kill* jika waktu eksekusi melampaui batas (*FR-212*).

---

## 5. Aturan Keamanan & Kedaulatan Manusia (Security Invariants)

1. **Invariant 5 (Sandbox Boundary & Anti-Traversal):**
   Bot sama sekali tidak dapat mengakses, membaca, atau memodifikasi file di luar direktori yang terdaftar di `almudaya context root`. Upaya akses menggunakan `..` atau path absolut di luar root langsung dibatalkan dengan eksepsi keamanan `PathTraversalSecurityError`.
2. **Invariant 6 (Review Sovereignty):**
   Pada mode `REQUEST_REVIEW` (default), setiap kali bot memutuskan untuk memanggil perkakas mutasi (`write_file`, `edit_file`, `run_command`), bot akan menjeda eksekusi dan meminta konfirmasi manusia di terminal:
   ```text
   [REVIEW REQUIRED] Bot "Coder" (BOT002) meminta izin eksekusi:
     Aksi: write_file
     Berkas Target: src/Button.tsx
   Apakah Anda menyetujui aksi ini? [y = Setuju, n = Tolak, d = Lihat Detail] (y/n/d): 
   ```
   Operator memiliki hak veto penuh: jika dijawab `n`, operasi dibatalkan dan alasan penolakan dikembalikan ke model AI untuk mencari solusi alternatif.
3. **Invariant 7 (Credential Privacy):**
   Nilai API key diselesaikan murni dari memori proses lokal (`process.env.GEMINI_API_KEY`). Dilarang keras menuliskan API key ke Blackboard storage, berkas JSON, atau log event publik.
