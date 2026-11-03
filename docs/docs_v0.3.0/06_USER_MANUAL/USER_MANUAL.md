# User Manual — Almudaya Multi-Agent v0.3.0
*The Interactive Bot Console & Cross-Root Orchestration Engine*

---

## 1. Ringkasan Fitur v0.3.0

Almudaya Multi-Agent v0.3.0 menghadirkan dua inovasi utama:
1. **Interactive Bot Console REPL (All-in-One Terminal):** Menjalankan `almudaya bot run` membuka antarmuka prompt interaktif non-blocking (`<BotName>> `) yang memungkinkan operator berinteraksi langsung, mengirim pesan ke bot lain, memantau rekan bot, dan menginstruksikan bot lokal secara langsung tanpa perlu membuka terminal tambahan.
2. **Cross-Root Location-Aware Session Work Memory (`work_log.jsonl`):** Seluruh aksi mutasi berkas (`write_file`, `edit_file`) dan eksekusi shell (`run_command`) secara otomatis dicatat ke memori kerja sesi terpadu dengan koordinat lokasi presisi multi-root (`target_root_id`, `target_root_name`, `target_root_path`, `relative_path`).

---

## 2. Memulai Konsol Interaktif Bot (`almudaya bot run`)

### 2.1 Perintah Peluncuran
```bash
almudaya bot run --session <SESSION_ID> [opsi...]
```

### 2.2 Opsi CLI Lengkap
| Opsi | Alias | Deskripsi | Default |
|---|---|---|---|
| `-s, --session <id>` | | **Wajib.** ID Sesi kolaborasi target. | - |
| `-b, --bot <id>` | | ID stabil bot lokal (misal `B001`, `BOT_CODER`). | Auto-generated |
| `-n, --name <name>` | `--display-name` | Nama bot manusiawi (misal: "Architect", "Coder"). | Bot ID |
| `-r, --role <role>` | `-d, --description` | Peran/tugas bot (misal: "Lead System Architect"). | - |
| `-p, --provider <name>` | | Provider model AI (`gemini` atau `mock`). | Auto-detect |
| `-m, --model <name>` | | Nama model AI (misal `gemini-2.5-flash`). | `gemini-2.5-flash` |
| `--api-key <key>` | | Kunci API model AI (opsional jika `$env:GEMINI_API_KEY` aktif). | - |
| `--mode <mode>` | | Mode keamanan: `review` (Human-in-the-Loop) atau `turbo`. | `review` |
| `--max-iterations <n>` | | Batas perulangan ReAct loop per pesan. | `10` |
| `--auto-ack` | | Otomatis mengakui pesan langsung setelah dibaca. | `true` |
| `-w, --workspace <path>` | | Path direktori penyimpanan Blackboard. | Direktori aktif |

---

## 3. Antarmuka Konsol REPL & Perintah Slash

Saat bot aktif, terminal menampilkan banner bot dan prompt interaktif:
```text
================================================================
 Almudaya Multi-Agent v0.3.0 — Interactive Bot Console REPL
 Bot: "Architect" [B001] | Session: S001
 Mode: REQUEST_REVIEW | Provider: Google Gemini (gemini-2.5-flash)
 Ketik /help untuk daftar perintah slash atau ketik instruksi langsung.
================================================================
Architect> 
```

### 3.1 Daftar Perintah Slash (Slash Commands)
| Perintah | Contoh | Deskripsi |
|---|---|---|
| `/msg <bot> <pesan>` | `/msg Coder Tolong buat REST API` | Mengirim pesan langsung ke bot lain (bisa menggunakan ID atau display name). |
| `/broadcast <pesan>` | `/broadcast Desain arsitektur selesai` | Menyiarkan pesan broadcast ke seluruh bot di dalam session. |
| `/peers` | `/peers` | Menampilkan seluruh rekan bot aktif dan stale dalam session beserta perannya. |
| `/roots` | `/roots` | Menampilkan daftar direktori kerja (*project roots*) yang terdaftar. |
| `/log [limit] [root]` | `/log 5 backend` | Menampilkan riwayat rekaman kerja sesi terkini dengan filter root opsional. |
| `/mode [review\|turbo]` | `/mode turbo` | Memeriksa atau beralih antara mode `REQUEST_REVIEW` dan `TURBO` seketika. |
| `/status` | `/status` | Menampilkan ringkasan status bot lokal, PID proses, provider, dan mode. |
| `/clear` | `/clear` | Membersihkan layar terminal. |
| `/help` | `/help` | Menampilkan bantuan ringkas daftar perintah konsol. |
| `/exit`, `/quit` | `/exit` | Menghentikan proses bot secara aman (*graceful*) dan keluar. |

### 3.2 Instruksi Bahasa Alami (Direct AI Instructions)
Setiap teks yang diketik tanpa awalan slash (`/`) langsung diproses oleh model AI bot lokal:
```text
Architect> Analisis berkas package.json dan buatkan rancangan arsitektur
🤖 [Architect] Memproses instruksi operator: "Analisis berkas package.json dan buatkan rancangan arsitektur"...

✅ [Architect]:
Saya telah memeriksa package.json. Proyek ini menggunakan TypeScript dan Node.js >=22.12.0. Berikut adalah rancangan modul...
```

---

## 4. Mekanisme Keamanan Human-in-the-Loop (Mode `REQUEST_REVIEW`)

Jika bot berjalan dalam mode `REQUEST_REVIEW` (default), setiap aksi yang berpotensi mengubah disk (`write_file`, `edit_file`) atau mengeksekusi shell (`run_command`) akan menampilkan dialog konfirmasi langsung di konsol:
```text
[REVIEW REQUIRED]
Bot "Coder" meminta persetujuan eksekusi:
  Perkakas: write_file
  Parameter:
    path: "src/server.ts"
    content: "export const app = express();..."
Apakah Anda menyetujui tindakan ini? (y/n/d for diff): 
```
- Ketik `y` atau `yes`: Menyetujui tindakan.
- Ketik `n` atau `no`: Menolak tindakan (bot akan bernalar mencari alternatif).
- Ketik `d`: Menampilkan diff perubahan.

---

## 5. Non-Destructive TTY Output Rendering

Ketika operator sedang mengetik teks di baris prompt dan tiba-tiba ada pesan masuk dari bot lain:
- Sistem menggunakan escape sequence ANSI `\r\x1b[K` untuk membersihkan baris kursor.
- Notifikasi pesan baru dicetak di atas garis prompt.
- Prompt dan draf teks yang sedang diketik operator dipulihkan kembali secara otomatis.
- **Teks ketikan operator tidak akan hilang atau bercampur dengan notifikasi masuk!**
