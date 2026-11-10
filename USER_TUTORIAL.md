# Almudaya Multi-Agent v0.2.0 — Hands-on Step-by-Step Tutorial

Panduan praktis langkah demi langkah untuk menguji dan memahami ekosistem kolaborasi multi-agent otonom Almudaya Multi-Agent (`almudaya-multiagent` v0.2.0 — The Autonomous AI Coding Agent Engine) secara langsung di komputer Anda.

Tutorial ini disusun berdasarkan alur pengujian nyata yang terbukti berhasil menghubungkan proses bot independen dalam multi-terminal dan mengeksekusi koding otonom langsung ke root direktori proyek target.

---

## 📋 Skenario Tutorial

Kita akan membangun lingkungan kolaborasi nyata dengan konfigurasi:
1. **Target Proyek Eksternal:** Folder kerja di luar engine, misalnya di `D:\testingbot`.
2. **Session Kolaborasi:** Session `S002` bernama `proyek-baru`.
3. **Dua Bot Independen:**
   - `BOT001` ("Architect") — Arsitek Sistem (Terminal 1).
   - `BOT002` ("Coder") — Software Engineer bertenaga AI (Terminal 2).
4. **Satu Terminal Operator (Terminal 3):** Untuk mengirim instruksi langsung atau memantau status.

---

## BAGIAN I: Persiapan Workspace & Registri Multi-Process

### Langkah 1: Persiapan Global CLI Engine

Buka PowerShell / Command Prompt pertama Anda, arahkan ke folder engine Almudaya:

```powershell
cd D:\almudaya_multiagent_v0.1.0

# 1. Kompilasi kode sumber TypeScript
npm run build

# 2. Daftarkan CLI 'almudaya' ke sistem global Windows
npm link

# 3. Uji apakah CLI sudah aktif secara global
almudaya --version
```
Jika muncul output `0.2.0`, artinya perintah `almudaya` kini dapat dipanggil dari folder mana pun di komputer Anda!

---

### Langkah 2: Pindah ke Direktori Target di Luar Engine

Pindah ke folder di luar engine (misalnya folder proyek Anda di `D:\testingbot`):

```powershell
# Buat folder jika belum ada, lalu masuk ke dalamnya:
cd D:\
mkdir testingbot
cd testingbot
```

Periksa daftar session awal:
```powershell
almudaya session list
```
Sistem akan melaporkan:
`No sessions found in workspace: C:\Users\<User>\AppData\Local\almudaya`
*(Ini membuktikan bahwa workspace tersimpan di folder sistem yang aman dan tidak mengotori `D:\testingbot`).*

---

### Langkah 3: Buat Session Baru

Di dalam `D:\testingbot`, buat Session baru dengan ID `S002`:

```powershell
almudaya session create proyek-baru --session S002
```

Output:
```text
Session created successfully!
  Session ID:   S002
  Name:         proyek-baru
  Status:       active
  Created:      2026-11-02T...
  Location:     C:\Users\<User>\AppData\Local\almudaya\sessions\S002
```

---

### Langkah 4: Daftarkan `D:\testingbot` sebagai Target Project Root

Agar bot diizinkan menganalisis, membaca, membuat, dan mengedit file (*Invariant 5 Sandboxing*), daftarkan folder `D:\testingbot` ke dalam session:

```powershell
almudaya context root add --session S002 --name testing --path D:\testingbot
```

Periksa hasilnya:
```powershell
almudaya context root list --session S002
```
Output:
```text
Project roots in Session [S002]:

  - [testing] testing (primary) -> D:\testingbot
```

---

### Langkah 5: Daftarkan Identitas Dua Bot ke Session

Daftarkan bot Arsitek dan bot Coder:

```powershell
# Bot 1: Architect
almudaya bot join --session S002 --bot BOT001 --display-name "Architect" --role "System Architect"

# Bot 2: Coder
almudaya bot join --session S002 --bot BOT002 --display-name "Coder" --role "Software Engineer"
```

Periksa registri bot:
```powershell
almudaya bot list --session S002
```
Output:
```text
Bots in Session [S002]:

  - [BOT001] "Architect" (stale)
      Role: System Architect
      PID: 31420, Joined: 2026-11-02T...
  - [BOT002] "Coder" (stale)
      Role: Software Engineer
      PID: 21036, Joined: 2026-11-02T...
```

---

## BAGIAN II: Mengaktifkan Koding AI Otonom Multi-Terminal

Sekarang atur layar Anda agar menampilkan **3 jendela terminal berdampingan**:

### 🖥️ Terminal 1 (Kiri): Jalankan Daemon Bot "Architect"
Di terminal pertama Anda di `D:\testingbot`, jalankan runtime bot `BOT001`:
```powershell
almudaya bot run --session S002 --bot BOT001
```
Output:
```text
Bot runtime started successfully!
  Session ID:     S002
  Bot ID:         BOT001
  Display Name:   Architect
  PID:            27724
  AI Provider:    Disabled (Messaging only)
  Execution Mode: REQUEST_REVIEW
Press Ctrl+C to terminate bot process.
```
*(Terminal 1 sekarang aktif secara live, memompa heartbeat, dan memantau inbox).*

---

### 🖥️ Terminal 2 (Kanan Atas): Jalankan Bot "Coder" Bertenaga AI Google Gemini
Buka jendela Command Prompt / PowerShell kedua, masuk ke `D:\testingbot`:

1. **Setel API Key Gemini Anda:**
   ```powershell
   $env:GEMINI_API_KEY="<YOUR_GEMINI_API_KEY>"
   ```
   *(Atau gunakan flag `--provider mock` jika ingin mencoba secara offline tanpa API key).*

2. **Jalankan Bot Coder dengan Mode TURBO (Otonom Penuh):**
   ```powershell
   almudaya bot run --session S002 --bot BOT002 --provider gemini --mode turbo
   ```
   Output:
   ```text
   Bot runtime started successfully!
     Session ID:     S002
     Bot ID:         BOT002
     Display Name:   Coder
     PID:            25872
     AI Provider:    gemini (gemini-2.5-flash)
     Execution Mode: TURBO
   Press Ctrl+C to terminate bot process.
   ```
   *(Terminal 2 sekarang siap berpikir mandiri, memanggil perkakas file/shell, dan menulis kode langsung ke `D:\testingbot`!)*

> [!TIP]
> **Pilihan Mode Keamanan:**
> - Jika Anda menggunakan `--mode turbo`, Coder akan langsung mengedit file dan menjalankan perintah secara mandiri.
> - Jika Anda menggunakan `--mode review` (default), setiap kali Coder hendak menulis file atau menjalankan command, terminal akan meminta persetujuan Anda: `[y = Setuju, n = Tolak, d = Lihat Detail] (y/n/d):`.

---

### 🖥️ Terminal 3 (Kanan Bawah): Berikan Tugas Koding Nyata!
Buka jendela terminal ketiga di `D:\testingbot`. Kirimkan pesan tugas koding dari `BOT001` (Architect) kepada `BOT002` (Coder):

```powershell
almudaya message send --session S002 --sender BOT001 --recipient "Coder" --body "Halo Coder! Tolong buatkan modul kalkulator 'src/math.js' dengan fungsi add(a, b) dan multiply(a, b), lalu uji hasilnya menggunakan perintah node."
```

Output di Terminal 3:
```text
Message sent successfully!
  Message ID: msg_...
  Session ID: S002
  Sender:     BOT001
  Recipient:  BOT002
  Type:       DIRECT
```

---

## 🚀 Amati Aksi Otonom di Terminal 2 & Terminal 1!

### Apa yang terjadi di Terminal 2 (Bot "Coder"):
Tanpa Anda sentuh, Bot Coder akan langsung:
1. Menangkap pesan masuk dari Architect.
2. Membentuk System Prompt dinamis dengan konteks proyek `D:\testingbot`.
3. Memanggil perkakas `write_file` untuk membuat `src/math.js`.
4. Memanggil perkakas `run_command` untuk menjalankan verifikasi node:
   `node -e "const { add } = require('./src/math.js'); console.log(add(3, 4));"`
5. Menghasilkan ringkasan dan secara otomatis mengirimkan pesan balasan kembali ke inbox Architect!
6. Mencatat seluruh jejak audit ke Session Blackboard (`events.jsonl`).

### Apa yang terjadi di Terminal 1 (Bot "Architect"):
Terminal 1 secara instan menerima balasan konfirmasi dari Coder:
```text
[BOT BOT001] Received message from BOT002: Modul src/math.js telah berhasil dibuat dan seluruh verifikasi pengujian fungsi add dan multiply telah lulus dengan sukses.
```

---

### Langkah 7: Buktikan File Baru Telah Tercipta di Disk!
Di Terminal 3, periksa isi folder `D:\testingbot`:

```powershell
dir src
type src\math.js
```
File `src\math.js` benar-benar telah dibuat di hard drive Anda oleh agen AI Almudaya!

---

## Langkah 8: Mematikan & Memulihkan Proses (Crash Recovery)

1. Di Terminal 2, tekan `Ctrl + C`. Bot `BOT002` akan berhenti secara aman (*graceful shutdown*).
2. Di Terminal 3, ketik `almudaya bot list --session S002`. Sistem akan langsung mendeteksi `BOT002` sebagai `stopped` atau `stale`, sedangkan `BOT001` tetap `active`.
3. Jalankan kembali `almudaya bot run --session S002 --bot BOT002 --provider gemini --mode turbo`. Bot akan langsung pulih kembali dan seluruh riwayat percakapan masa lalu tetap tersimpan utuh di Blackboard.

---

## Selamat! 🎉
Anda telah berhasil menjalankan **Almudaya Multi-Agent v0.2.0** — ekosistem multi-agent independen pertama yang menggabungkan ketahanan arsitektur Blackboard multi-proses dengan kekuatan koding otonom Google Gemini AI!
