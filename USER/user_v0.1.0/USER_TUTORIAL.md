# Almudaya Multi-Agent — Hands-on Step-by-Step Tutorial

Panduan praktis langkah demi langkah untuk menguji dan memahami ekosistem kolaborasi multi-agent Almudaya Multi-Agent (`almudaya-multiagent` v0.1.0) secara langsung di komputer Anda.

Tutorial ini disusun berdasarkan alur pengujian nyata yang terbukti berhasil menghubungkan proses bot independen dalam multi-terminal.

---

## 📋 Skenario Tutorial

Kita akan membangun lingkungan kolaborasi nyata dengan konfigurasi:
1. **Target Proyek Eksternal:** Folder kerja baru di luar engine, misalnya di `D:\testingbot`.
2. **Session Kolaborasi:** Session `S002` bernama `proyek-baru`.
3. **Dua Bot Independen:**
   - `BOT001` ("Architect") — Arsitek Sistem (Terminal 1).
   - `BOT002` ("Coder") — Software Engineer (Terminal 2).
4. **Satu Terminal Operator (Terminal 3):** Untuk mengirim instruksi langsung antar-bot.

---

## Langkah 1: Persiapan Global CLI Engine

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
Jika muncul output `0.1.0`, artinya perintah `almudaya` kini dapat dipanggil dari folder mana pun di komputer Anda!

---

## Langkah 2: Pindah ke Direktori Target di Luar Engine

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

## Langkah 3: Buat Session Baru

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

## Langkah 4: Daftarkan Target Proyek ke dalam Konteks Session

Beri tahu para bot bahwa folder `D:\testingbot` adalah basis proyek yang sedang digarap:

```powershell
almudaya context root add --session S002 --name testing --path D:\testingbot
```

Verifikasi dengan melihat daftar root:
```powershell
almudaya context root list --session S002
```
Output:
```text
Project roots in Session [S002]:

  - [testing] testing (primary) -> D:\testingbot
```

---

## Langkah 5: Daftarkan Kedua Bot ke Session (Join)

Daftarkan bot pertama (`BOT001` - "Architect"):
```powershell
almudaya bot join --session S002 --bot BOT001 --display-name "Architect" --role "System Architect"
```

Daftarkan bot kedua (`BOT002` - "Coder"):
```powershell
almudaya bot join --session S002 --bot BOT002 --display-name "Coder" --role "Software Engineer"
```

Periksa daftar bot terdaftar (Peer Discovery):
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

> [!TIP]
> **Mengapa statusnya `(stale)`?**
> Karena perintah `bot join` adalah perintah pendaftaran satu kali yang langsung selesai (*exit*). Fitur *Stale Detection* Almudaya secara akurat mendeteksi bahwa proses PID tersebut sudah tidak berjalan di Windows. Di langkah berikutnya, kita akan membuat bot menjadi `(active)` secara live!

---

## Langkah 6: Jalankan Multi-Terminal Interaktif (3 Jendela)

Sekarang atur layar Anda agar menampilkan **3 jendela terminal berdampingan**:

### 🖥️ Terminal 1 (Kiri): Jalankan Daemon Bot "Architect"
Di terminal pertama Anda di `D:\testingbot`, jalankan runtime bot `BOT001`:
```powershell
almudaya bot run --session S002 --bot BOT001
```
Output:
```text
Bot runtime started successfully!
  Session ID:   S002
  Bot ID:       BOT001
  Display Name: Architect
  PID:          27724
Press Ctrl+C to terminate bot process.
```
*(Terminal 1 sekarang aktif secara live, memompa heartbeat, dan mengawasi inbox).*

---

### 🖥️ Terminal 2 (Kanan Atas): Jalankan Daemon Bot "Coder"
Buka jendela Command Prompt / PowerShell baru, masuk ke `D:\testingbot`, lalu jalankan:
```powershell
cd D:\testingbot
almudaya bot run --session S002 --bot BOT002
```
Output:
```text
Bot runtime started successfully!
  Session ID:   S002
  Bot ID:       BOT002
  Display Name: Coder
  PID:          25872
Press Ctrl+C to terminate bot process.
```
*(Terminal 2 sekarang aktif secara live dengan PID sistem operasi yang berbeda dari Terminal 1).*

---

### 🖥️ Terminal 3 (Kanan Bawah): Operator / Interaksi Antar-Bot
Buka jendela terminal ketiga di `D:\testingbot`. Kirimkan pesan langsung dari `BOT002` kepada `"Architect"`:

```powershell
almudaya message send --session S002 --sender BOT002 --recipient "Architect" --body "Halo Architect! Saya Coder, siap menerima instruksi rancangan."
```

Output di Terminal 3:
```text
Message sent successfully!
  Message ID: msg_...
  Session ID: S002
  Sender:     BOT002
  Recipient:  BOT001
  Type:       DIRECT
  Timestamp:  2026-11-02T...
  Content:    Halo Architect! Saya Coder, siap menerima instruksi rancangan.
```

---

## Langkah 7: Amati Hasil Real-Time di Terminal 1! 🚀

Sekarang perhatikan apa yang terjadi di **Terminal 1 (Bot "Architect")**:
Tanpa Anda sentuh sama sekali, Terminal 1 akan langsung menampilkan pesan:

```text
[BOT BOT001] Received message from BOT002: Halo Architect! Saya Coder, siap menerima instruksi rancangan.
```

Ini membuktikan secara langsung:
1. **Dynamic Name Resolution:** Nama `"Architect"` otomatis diantarkan ke inbox `BOT001`.
2. **Process Isolation:** Terminal 1 dan Terminal 2 berjalan pada proses independen tanpa saling memblokir.
3. **Reactive Delivery:** Pesan terkirim, terbaca, dan di-acknowledge secara instan di Blackboard.

---

## Langkah 8: Broadcast Pengumuman Bersama

Di Terminal 3 (Operator), coba publikasikan sebuah keputusan arsitektur untuk seluruh bot:

```powershell
almudaya broadcast publish --session S002 --bot BOT001 --category DECISION --payload '{"architecture": "Clean Architecture", "db": "PostgreSQL"}'
```

Kedua terminal daemon (Terminal 1 dan Terminal 2) dapat memantau dan mencatat event broadcast tersebut!

---

## Langkah 9: Mematikan & Memulihkan Proses (Crash Recovery)

1. Di Terminal 1, tekan `Ctrl + C`. Bot `BOT001` akan berhenti secara aman (*graceful shutdown*).
2. Di Terminal 3, ketik `almudaya bot list --session S002`. Sistem akan langsung mendeteksi `BOT001` sebagai `stopped` atau `stale`, sedangkan `BOT002` tetap `active`.
3. Jalankan kembali `almudaya bot run --session S002 --bot BOT001`. Bot akan langsung pulih kembali dan seluruh riwayat percakapan masa lalu tetap tersimpan utuh di Blackboard.

---

## Selamat! 🎉
Anda telah menguasai alur kerja lengkap kolaborasi multi-agent independen dengan Almudaya Multi-Agent.
