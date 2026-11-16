# Almudaya Multi-Agent v0.3.5 — Hands-on Step-by-Step Tutorial

Panduan praktis langkah demi langkah untuk menjalankan ekosistem kolaborasi multi-agent otonom **Almudaya Multi-Agent (`almudaya-multiagent` v0.3.5)**, termasuk:
1. Orkestrasi satu-perintah **Unified HITL + Master Bot (`almudaya up`)** atau multi-proses lintas-terminal dengan **Interactive Bot Console REPL** (*Unified Natural Lifecycle* & **10 Protokol Atomic `IProtocol`**),
2. Pemilihan model AI fleksibel secara langsung melalui **Ollama (Lokal)**, **NVIDIA NIM**, **Google Gemini**, **OpenRouter**, atau **9router** — lengkap dengan **Hardware Spec Advisor** (`almudaya bot advisor`) dan pengunduh model Ollama (`almudaya bot pull` & `/model pull`),
3. Tata kelola keamanan **Agent Capability Governance (ACG)**,
4. Pemanfaatan modul **Almudaya Visual Design Skills (AVDS v1.0.1)** melalui CLI `almudaya skill`, perintah REPL `/skill`, dan perkakas AI otonom `use_skill`,
5. Sinkronisasi memori kerja bersama (`work_log.jsonl`) dan **PKU Unified Persistent Memory Architecture (Spec v0.2)** dengan kebijakan **PKU-First Reading** (`query_pku_memory`).

---

## 📋 Skenario Tutorial

Kita akan membangun lingkungan kolaborasi nyata dengan konfigurasi:
1. **Target Proyek Eksternal:** Folder kerja di luar engine, misalnya di `D:\testingbot`.
2. **Session Kolaborasi:** Session `S002` bernama `proyek-quantum-ui`.
3. **Dua Bot Independen dengan Konsol REPL Interaktif:**
   - `BOT001` (`"Architect"`) — UI/UX & System Architect yang merancang *Composition Plan* berbasis **AVDS v1.0.1** (Terminal 1).
   - `BOT002` (`"Coder"`) — Fullstack Engineer bertenaga AI Google Gemini yang mengimplementasikan kode dan mengujinya (Terminal 2).

---

## BAGIAN I: Persiapan Workspace, Root Proyek, Capability & Skill AVDS

### Langkah 1: Kompilasi & Registrasi Global CLI Engine

Buka PowerShell / Command Prompt pertama Anda, arahkan ke folder engine Almudaya:

```powershell
cd D:\almudaya_multiagent_v0.1.0

# 1. Kompilasi kode sumber TypeScript
npm run build

# 2. Daftarkan CLI 'almudaya' ke sistem global
npm link

# 3. Verifikasi versi CLI
almudaya --version
```
Pastikan output menampilkan **`0.3.5`**.

> [!TIP]
> **Cara Cepat v0.3.5 (`almudaya up`):** Mulai `v0.3.5`, Anda dapat langsung menjalankan konsol HITL + **Master Bot (`BOT000`)** yang otomatis membuka terminal worker dan mengawal *Unified Natural Lifecycle* dalam satu perintah:
> ```powershell
> almudaya up --root D:\testingbot --provider gemini --spawn-mode windows
> ```
> Jika Anda ingin memahami arsitektur manual proses demi proses, ikuti Langkah 2–8 di bawah ini.

---

### Langkah 2: Siapkan Folder Target Proyek & Buat Session Baru

```powershell
cd D:\
mkdir testingbot
cd testingbot

# Buat Session baru dengan ID S002
almudaya session create proyek-quantum-ui --session S002 --description "Kolaborasi desain dan implementasi dengan AVDS v1.0.1 & PKU Memory"
```

---

### Langkah 3: Daftarkan Target Project Root & Terapkan Preset Kapabilitas (ACG)

1. Daftarkan folder `D:\testingbot` sebagai target *project root* utama:
   ```powershell
   almudaya context root add --session S002 --id app-root --name "Quantum Lab App" --path D:\testingbot --type primary
   ```
2. Terapkan preset izin kapabilitas `standard_coding` agar bot memiliki izin eksekusi terarah di dalam `D:\testingbot`:
   ```powershell
   almudaya capability preset apply standard_coding --session S002 --paths D:\testingbot
   almudaya capability list --session S002
   ```

---

### Langkah 4: Eksplorasi & Aktifkan Modul Skill AVDS v1.0.1

Sebelum menjalankan bot, mari kita jelajahi katalog **Almudaya Visual Design Skills (AVDS v1.0.1)** melalui CLI:

```powershell
# 1. Lihat modul skill yang terpasang
almudaya skill list

# 2. Lihat detail sub-skill, skema kontrak, dan skenario benchmark AVDS
almudaya skill inspect almudaya-visual-design

# 3. Lihat daftar profil gaya visual keluarga 'futuristic' dan 'specialized'
almudaya skill styles --family futuristic
almudaya skill styles --family specialized

# 4. Baca spesifikasi lengkap profil gaya 'quantum-futurism'
almudaya skill styles quantum-futurism

# 5. Lihat 13 profil platform dan 10 modalitas interaksi
almudaya skill platforms
almudaya skill modalities
```

Sekarang aktifkan skill **AVDS (`almudaya-visual-design`)** untuk Session `S002` dengan gaya utama `quantum-futurism`, pengaruh sekunder `scientific-visualization`, platform `web`, dan modalitas `keyboard` serta `mouse-pointer`:

```powershell
almudaya skill enable avds --session S002 --style quantum-futurism --secondary-styles scientific-visualization --platform web --modalities keyboard mouse-pointer --entry-point full-cycle --notes "Gunakan komposisi spasial modular dan kontras WCAG 2.2 AA"
```

Periksa status ikatan skill pada sesi `S002` (yang juga otomatis tersinkronisasi ke penyimpanan **PKU Memory**):
```powershell
almudaya skill list --session S002
```

---

### Langkah 5: Daftarkan Identitas Dua Bot ke Session

```powershell
# Bot 1: Architect
almudaya bot join --session S002 --bot BOT001 --display-name "Architect" --role "System & UI/UX Architect"

# Bot 2: Coder
almudaya bot join --session S002 --bot BOT002 --display-name "Coder" --role "Frontend & Systems Engineer"
```

---

## BAGIAN II: Kolaborasi Multi-Terminal dengan Interactive Bot Console REPL

Dengan fitur **Interactive Bot Console REPL**, Anda cukup menggunakan **2 jendela terminal** (satu untuk setiap bot) tanpa memerlukan terminal ketiga!

### 🖥️ Terminal 1 (Kiri): Jalankan Bot "Architect"

```powershell
$env:GEMINI_API_KEY="<YOUR_GEMINI_API_KEY>"
almudaya bot run --session S002 --bot BOT001 --provider gemini --mode review
```
Terminal 1 akan menampilkan banner interaktif dan prompt `Architect> `:
```text
================================================================
 Almudaya Multi-Agent v0.3.3 — Interactive Bot Console REPL
 Bot: "Architect" [BOT001] | Session: S002
 Mode: REQUEST_REVIEW | Provider: gemini (gemini-2.5-flash)
 Ketik /help untuk daftar perintah slash atau ketik instruksi langsung.
================================================================
Architect> 
```

Di dalam prompt `Architect> `, coba jalankan perintah slash berikut:
```text
Architect> /peers
Architect> /roots
Architect> /model
Architect> /skill list
Architect> /skill styles futuristic
```
> **Tips Multi-Provider Langsung (`--provider ollama`, `nvidia`, `9router`, & `openrouter`) + Hardware Advisor:** Anda dapat memeriksa kecocokan spek komputer Anda, mengunduh model lokal via Ollama, atau langsung memakai NVIDIA NIM / 9router / OpenRouter:
> ```powershell
> # 1. Periksa spek laptop/PC (CPU, RAM, GPU/VRAM) & dapatkan rekomendasi model lokal + cloud gratis
> almudaya bot advisor
> # (atau: almudaya bot models --recommend)
>
> # 2. Unduh & jalankan model lokal Ollama yang cocok dengan spek Anda (tanpa API key)
> almudaya bot pull qwen2.5-coder:7b
> almudaya bot models --provider ollama
> almudaya bot run --session S002 --bot BOT001 --provider ollama --model qwen2.5-coder:7b --mode review
>
> # 3. Menggunakan NVIDIA NIM secara langsung
> $env:NVIDIA_API_KEY="nvapi-xxxxxxxxxxxxxxxxxxxxxxxx"
> almudaya bot models --provider nvidia
> almudaya bot run --session S002 --bot BOT001 --provider nvidia --model meta/llama-3.3-70b-instruct --mode review
>
> # 4. Atau menggunakan 9router lokal (set NINEROUTER_API_KEY jika router memakai key)
> almudaya bot models --provider 9router
> $env:NINEROUTER_API_KEY="<NINEROUTER_API_KEY_JIKA_ADA>"
> almudaya bot run --session S002 --bot BOT001 --provider 9router --model mycombo --mode review
> ```
> Di dalam REPL kapan saja, ketik `/model recommend` untuk analisis hardware, `/model pull qwen2.5-coder:7b` untuk mengunduh model Ollama, `/model list ollama` atau `/model list nvidia` untuk melihat daftar model, lalu `/model qwen2.5-coder:7b ollama`, `/model deepseek-ai/deepseek-r1 nvidia`, `/model mycombo 9router`, atau `/model deepseek/deepseek-chat-v3-0324:free openrouter` untuk mengganti model tanpa me-restart bot.

---

### 🖥️ Terminal 2 (Kanan): Jalankan Bot "Coder" di Mode TURBO

Buka jendela terminal kedua di `D:\testingbot`:

```powershell
$env:GEMINI_API_KEY="<YOUR_GEMINI_API_KEY>"
almudaya bot run --session S002 --bot BOT002 --provider gemini --mode turbo
```
Terminal 2 akan menampilkan prompt `Coder> `.

---

### 🚀 Langkah 6: Kirim Tugas Berbasis Skill AVDS dari Konsol "Architect" ke "Coder"

Di **Terminal 1 (`Architect> `)**, kirimkan pesan tugas langsung ke `Coder` menggunakan perintah `/msg`:

```text
Architect> /msg Coder Tolong gunakan tool use_skill untuk membaca profil gaya 'quantum-futurism' dan platform 'web', lalu buatkan berkas 'src/theme-tokens.json' dan modul 'src/math.js' beserta pengujiannya dengan node.
```

### Apa yang Terjadi Secara Otonom di Terminal 2 (`Coder> `)?
1. Bot **Coder** langsung menerima pesan dengan *non-destructive TTY rendering* (tanpa merusak baris prompt).
2. `AutonomousAgentLoop` secara otomatis menyuntikkan **PKU-First Reading Policy** dan konfigurasi aktif **AVDS (`quantum-futurism`, `web`, `keyboard`, `mouse-pointer`)** ke dalam System Prompt Coder.
3. Coder terlebih dahulu memanggil **`query_pku_memory`** untuk memeriksa ringkasan kode/graf pengetahuan proyek di PKU sebelum membaca atau menulis berkas penuh.
4. Coder memanggil perkakas **`use_skill`** (`action: "get_style", target_id: "quantum-futurism"` dan `action: "get_platform", target_id: "web"`) untuk membaca spesifikasi desain resmi AVDS.
5. Coder memanggil **`write_file`** untuk menulis `src/theme-tokens.json` dan `src/math.js` di dalam `D:\testingbot`—sistem otomatis memperbarui indeks PKU **hanya untuk berkas yang baru ditulis/diubah** tanpa mengindeks ulang seluruh proyek.
6. Coder memanggil **`run_command`** untuk memverifikasi kode dengan `node`.
7. Seluruh mutasi berkas dan eksekusi perintah otomatis tercatat ke `work_log.jsonl`, serta Coder mengirim balasan langsung kembali ke `Architect`!

---

### Langkah 7: Periksa Riwayat Kerja & Validasi Kontrak AVDS

Di **Terminal 1 (`Architect> `)**, ketik:
```text
Architect> /log
```
Anda akan melihat linimasa lengkap seluruh berkas yang ditulis dan perintah yang dijalankan oleh `Coder` beserta lokasi root-nya.

Anda juga dapat memvalidasi berkas kontrak desain atau rencana komposisi AVDS kapan saja dari CLI:
```powershell
almudaya skill validate D:\almudaya_multiagent_v0.1.0\skill\almudaya-visual-design\design-contract\examples\design-contract-example.json
```
Output:
```text
AVDS Artifact Validation (design-contract): VALID ✅
```

---

### Langkah 8: Menghentikan Bot dengan Aman

Di masing-masing terminal bot (`Architect> ` dan `Coder> `), cukup ketik:
```text
/exit
```
Kedua bot akan melakukan *graceful shutdown*, melepaskan lock dengan bersih, dan menyimpan seluruh jejak sesi di Blackboard serta penyimpanan memori persisten PKU.
