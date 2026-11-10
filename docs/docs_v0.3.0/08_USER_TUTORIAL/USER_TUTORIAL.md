# User Tutorial — Almudaya Multi-Agent v0.3.0
*Tutorial Praktis Langkah-demi-Langkah: Membangun Proyek Multi-Root dengan 3 Bot*

---

## 1. Persiapan Lingkungan

Buka terminal utama (PowerShell atau Command Prompt) dan buat direktori kerja baru:
```bash
# Buat folder proyek uji coba
mkdir D:\almudaya_lab
cd D:\almudaya_lab

# Buat folder untuk multi-root
mkdir backend
mkdir frontend
```

Pastikan API Key Google Gemini telah dikonfigurasi:
```powershell
# Di PowerShell:
$env:GEMINI_API_KEY="<YOUR_GEMINI_API_KEY>"

# Atau di Command Prompt cmd.exe:
set "GEMINI_API_KEY=<YOUR_GEMINI_API_KEY>"
```

---

## 2. Inisialisasi Sesi & Pendaftaran Multi-Root

Jalankan perintah berikut di terminal:

```bash
# 1. Buat session kolaborasi baru
almudaya session create --session S001 --name "Lab Multi-Root v0.3.0"

# 2. Daftarkan root backend
almudaya context root register -s S001 --id backend --name "Backend API" --path ./backend --type primary

# 3. Daftarkan root frontend
almudaya context root register -s S001 --id frontend --name "Frontend Web" --path ./frontend --type primary
```

Periksa daftar root yang telah terdaftar:
```bash
almudaya context root list -s S001
```

---

## 3. Menjalankan Tiga Bot di Tiga Terminal

Sekarang buka **3 jendela terminal**:

### Jendela Terminal 1: Bot "Architect"
Jalankan Architect (tanpa provider AI, bertindak sebagai konsol pengawas operator):
```bash
almudaya bot run --session S001 --bot B001 --name Architect --role "System Architect"
```
*Terminal ini langsung masuk ke mode konsol interaktif:*
```text
Architect> 
```

### Jendela Terminal 2: Bot "Coder"
Jalankan Coder dengan provider Gemini dan mode TURBO:
```bash
almudaya bot run --session S001 --bot B002 --name Coder --role "Backend Engineer" --provider gemini --mode turbo
```
*Terminal ini siap menerima instruksi koding di root backend:*
```text
Coder> 
```

### Jendela Terminal 3: Bot "Tester"
Jalankan Tester dengan provider Gemini dan mode TURBO:
```bash
almudaya bot run --session S001 --bot B003 --name Tester --role "QA Engineer" --provider gemini --mode turbo
```
*Terminal ini siap memvalidasi kode di root frontend:*
```text
Tester> 
```

---

## 4. Mengontrol Seluruh Bot Langsung dari Terminal Architect

Kembali ke **Jendela Terminal 1 (Architect)**. Anda tidak perlu membuka terminal ke-4!

### 4.1 Periksa Rekan Bot Aktif
Ketik perintah:
```text
Architect> /peers
```
Output:
```text
[Console] Rekan Bot dalam Sesi [S001]:
  - [B001] "Architect" (active) (bot ini) - Role: System Architect - PID: 2140
  - [B002] "Coder" (active) - Role: Backend Engineer - PID: 8320
  - [B003] "Tester" (active) - Role: QA Engineer - PID: 9412
```

### 4.2 Tugaskan Coder untuk Membuat REST API di Backend
Ketik di Terminal Architect:
```text
Architect> /msg Coder Buatkan server Express sederhana di backend/src/server.js dengan route GET /health yang mengembalikan { status: "healthy" }, lalu periksa kodenya.
```

Lihat apa yang terjadi di **Jendela Terminal 2 (Coder)**:
- Coder menerima pesan secara instan.
- Coder memanggil perkakas `write_file` membuat `backend/src/server.js`.
- Aksi ini **secara otomatis dicatat ke `work_log.jsonl`** dengan lokasi `target_root_id: "backend"`.
- Coder membalas ke Architect: *"Server Express berhasil dibuat di src/server.js..."*

### 4.3 Tugaskan Tester untuk Menguji dari Frontend
Masih di **Jendela Terminal 1 (Architect)**, ketik:
```text
Architect> /msg Tester Periksa work log sesi kita, lihat server backend yang baru dibuat Coder, lalu buatkan integration test client di frontend/src/health.test.js.
```

Lihat apa yang terjadi di **Jendela Terminal 3 (Tester)**:
- Tester memanggil perkakas AI `get_work_log(root_id: "backend")`.
- Tester membaca log bahwa Coder telah membuat `src/server.js` di `backend`.
- Tester memanggil `write_file` di `frontend/src/health.test.js`.
- Tester menjalankan `node src/health.test.js` di `frontend`.
- Aksi ini **secara otomatis dicatat ke `work_log.jsonl`** dengan lokasi `target_root_id: "frontend"`.

### 4.4 Periksa Linimasa Memori Kerja Sesi
Kembali ke Terminal Architect, ketik:
```text
Architect> /log 10
```
Output mencerminkan rekaman lokasi multi-root yang sangat rapi:
```text
[Console] Riwayat Kerja Sesi (menampilkan 4 entri):
  - [2026-11-03 13:20:01 UTC] Coder [WRITE] root "Backend API" (src/server.js): Wrote file src/server.js
  - [2026-11-03 13:20:15 UTC] Coder [COMMAND] root "Backend API": Ran command: node --check src/server.js (exitCode: 0)
  - [2026-11-03 13:20:45 UTC] Tester [WRITE] root "Frontend Web" (src/health.test.js): Wrote file src/health.test.js
  - [2026-11-03 13:20:58 UTC] Tester [COMMAND] root "Frontend Web": Ran command: node src/health.test.js (exitCode: 0)
```

---

## 5. Menghentikan Bot Secara Bersih (Graceful Shutdown)

Di setiap terminal, cukup ketik:
```text
Architect> /exit
Coder> /exit
Tester> /exit
```
Setiap bot akan menghentikan interval detak jantung (*heartbeat*), memperbarui statusnya di Blackboard menjadi `stopped`, dan menutup terminal secara bersih tanpa menyisakan proses zombie.
