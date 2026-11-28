# Almudaya Multi-Agent v0.3.7 — Hands-on Step-by-Step Tutorial

> [!NOTE]
> Tutorial ini telah diperbarui untuk **`v0.3.7`** (*Agentic Operation v0.3 & Dynamic Swarm Manifold*). Jika Anda menginginkan skenario pengujian siap-salin yang disusun khusus untuk **Windows Command Prompt (`cmd.exe`)** mulai dari menyalakan aplikasi pertama kali, langsung buka [**`USER_TESTING.md`**](./USER_TESTING.md). Versi lama tutorial ini tetap diarsipkan pada `USER/`.

Panduan praktis langkah demi langkah untuk menjalankan ekosistem kolaborasi multi-agent otonom **Almudaya Multi-Agent (`almudaya-multiagent` v0.3.7)**, mencakup:
1. **Jalur Cepat Dynamic Swarm Manifold (`almudaya up --operation`)** dengan **Master Bot (`BOT000`)**, **#Operation (`almudaya.operation/v0.3`)**, serta **10 Protokol Atomic `IProtocol`**,
2. **Jalur Kolaborasi Multi-Terminal (`BOT001` + `BOT002`)** dengan **Interactive Bot Console REPL**,
3. Pemilihan model AI fleksibel melalui **Ollama (Lokal)**, **NVIDIA NIM**, **Google Gemini**, **OpenRouter**, atau **9router** — lengkap dengan **Hardware Spec Advisor** (`almudaya bot advisor`), `--failover` worker, dan pengunduh model Ollama (`almudaya bot pull`),
4. Tata kelola keamanan **Agent Capability Governance (ACG)** (`extended` preset) & **MCP (`almudaya mcp`)**,
5. Pemanfaatan modul **Almudaya Visual Design Skills (AVDS v1.0.1)** (`almudaya skill`, `/skill`, `use_skill`), serta
6. Memori kerja bersama (`work_log.jsonl`) dan **PKU Unified Persistent Memory (Spec v0.2)** (`query_pku_memory`).

---

## 📋 Skenario Tutorial

Anda dapat memilih **salah satu dari dua mode tutorial** (atau menjalankan keduanya berurutan):
- **Jalur Cepat (Bagian IA — `almudaya up`):** Satu perintah menghidupkan `BOT000` + memilih `#Operation-looping`, lalu worker (`developer`, `test_engineer`, `reviewer`) terbentuk dan berakhir otomatis sesuai topologi swarm dinamis.
- **Jalur Manual Multi-Terminal (Bagian IB & II):** Mengamati kolaborasi eksplisit antara:
  - **Target Proyek Eksternal:** `D:\testingbot`
  - **Session Kolaborasi:** `S002` (`proyek-quantum-ui`)
  - **`BOT001` (`"Architect"`)** — UI/UX & System Architect (`--mode review`, Terminal 1)
  - **`BOT002` (`"Coder"`)** — Fullstack Engineer (`--mode turbo`, Terminal 2)

---

## Langkah 1: Kompilasi & Registrasi Global CLI Engine

Buka PowerShell atau Command Prompt (`cmd.exe`), arahkan ke direktori engine Almudaya:

**PowerShell:**
```powershell
cd D:\almudaya_multiagent_v0.1.0
npm run build
npm link
almudaya --version
```

**Windows Command Prompt (`cmd.exe`):**
```cmd
cd /d D:\almudaya_multiagent_v0.1.0
npm run build
npm link
almudaya --version
```

Pastikan keluaran menampilkan **`0.3.7`**. Periksa pula katalog `#Operation v0.3` bawaan:
```bash
almudaya operation validate
```
Keluaran yang diharapkan:
```text
All 7 Operation(s) PASSED static semantic validation (0 errors).
```

> [!TIP]
> **Perbedaan Set Variabel Lingkungan di Windows:**
> - Di **PowerShell**: `$env:GEMINI_API_KEY="AIza..."` atau `$env:NVIDIA_API_KEY="nvapi-..."`
> - Di **`cmd.exe`**: `set "GEMINI_API_KEY=AIza..."` atau `set "NVIDIA_API_KEY=nvapi-..."` (jangan tulis `set KEY="val"` di CMD karena tanda kutip ikut tersimpan ke dalam nilai key!).

---

## BAGIAN IA: Jalur Cepat Dynamic Swarm Manifold (`almudaya up --operation`)

Sejak `v0.3.7`, Anda dapat langsung mengikat **`#Operation` (`almudaya.operation/v0.3`)** ketika menjalankan `almudaya up`, sehingga topologi swarm terbentuk dinamis mengikuti definisi `#Operation`:

1. Siapkan direktori target (mis. `D:\testingbot`) dan set kunci AI provider pilihan Anda (`GEMINI_API_KEY` / `NVIDIA_API_KEY` / `OPENROUTER_API_KEY` / `OLLAMA_BASE_URL`).
2. Jalankan `almudaya up` dengan `#Operation-looping` (atau `--provider nvidia` sesuai API key Anda):
   ```powershell
   almudaya up --root D:\testingbot --provider gemini --spawn-mode windows --operation #Operation-looping
   ```
3. Begitu masuk prompt `HITL [MASTER]> `, inspeksi topologi swarm yang sudah dimaterialisasi:
   ```text
   HITL [MASTER]> /operation status
   HITL [MASTER]> /protocol
   HITL [MASTER]> /blueprint
   ```
4. Berikan objektif nyata dalam bahasa alami agar `BOT000` men-spawn worker terpisah untuk implementasi dan pengujian (`developer` != `reviewer` sesuai aturan `anti_affinity`):
   ```text
   HITL [MASTER]> Bangun modul src/vector.js beserta pengujian unit tests/vector.test.js menggunakan node:test pada root D:\testingbot. Gunakan Role Archetype developer untuk implementasi dan test_engineer untuk pengujian terpisah, lalu jalankan tes hingga semua PASS.
   ```
5. Amati bagaimana `BOT000` men-spawn terminal worker baru, menugaskan `CapabilityToken` disjoin (`PrModerator`), mengevaluasi kemajuan melalui `GoalLedger`, dan menghentikan worker secara otomatis ketika tugas mencapai `DONE` / `TASK_0`.
6. Di akhir sesi, periksa evaluasi predikat **OBS** dan keluar aman:
   ```text
   HITL [MASTER]> /operation evaluate
   HITL [MASTER]> /bots
   HITL [MASTER]> /exit
   ```

---

## BAGIAN IB: Persiapan Workspace Manual, Root Proyek, ACG & Skill AVDS

Jika Anda ingin menjalankan **kolaborasi multi-terminal manual** langkah demi langkah tanpa `BOT000` auto-spawn, ikuti Langkah 2–8 di bawah ini.

### Langkah 2: Siapkan Folder Target Proyek & Buat Session Baru

```powershell
mkdir D:\testingbot
cd D:\testingbot

# Buat Session baru dengan ID S002
almudaya session create proyek-quantum-ui --session S002 --description "Kolaborasi desain dan implementasi dengan AVDS v1.0.1 & PKU Memory"
```

### Langkah 3: Daftarkan Target Project Root & Terapkan Preset Kapabilitas (ACG)

1. Daftarkan folder `D:\testingbot` sebagai target *project root* utama (format posisi: `almudaya context root add <name> <path> ...`):
   ```powershell
   almudaya context root add "Quantum Lab App" D:\testingbot --session S002 --id app-root --type primary
   ```
2. Terapkan preset izin kapabilitas resmi **`extended`** agar bot memiliki izin baca/tulis terarah di `D:\testingbot`, eksekusi toolchain (`git`, `npm`, `tsc`, `node`), dan akses `mcp.invoke`:
   ```powershell
   almudaya capability preset apply extended --session S002 --paths D:\testingbot
   almudaya capability list --session S002
   ```

### Langkah 4: Eksplorasi & Aktifkan Modul Skill AVDS v1.0.1

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

Aktifkan skill **AVDS (`almudaya-visual-design`)** untuk Session `S002`:
```powershell
almudaya skill enable avds --session S002 --style quantum-futurism --secondary-styles scientific-visualization --platform web --modalities keyboard mouse-pointer --entry-point full-cycle --notes "Gunakan komposisi spasial modular dan kontras WCAG 2.2 AA"
almudaya skill list --session S002
```

### Langkah 5: Daftarkan Identitas Dua Bot ke Session

```powershell
# Bot 1: Architect
almudaya bot join --session S002 --bot BOT001 --display-name "Architect" --role "System & UI/UX Architect"

# Bot 2: Coder
almudaya bot join --session S002 --bot BOT002 --display-name "Coder" --role "Frontend & Systems Engineer"
```

---

## BAGIAN II: Kolaborasi Multi-Terminal dengan Interactive Bot Console REPL

Dengan fitur **Interactive Bot Console REPL**, cukup gunakan **2 jendela terminal** (satu untuk setiap bot).

### 🖥️ Terminal 1 (Kiri): Jalankan Bot "Architect"

```powershell
$env:GEMINI_API_KEY="<YOUR_GEMINI_API_KEY>"
almudaya bot run --session S002 --bot BOT001 --provider gemini --mode review
```
Terminal 1 menampilkan banner interaktif `Almudaya Multi-Agent v0.3.7` dan prompt `Architect> `. Coba perintah slash berikut:
```text
Architect> /peers
Architect> /roots
Architect> /model
Architect> /skill list
Architect> /operation list
Architect> /mcp list
```

> **Tips Multi-Provider (`ollama`, `nvidia`, `9router`, & `openrouter`) + Worker Failover:**
> ```powershell
> # 1. Periksa spek komputer & rekomendasi model lokal/cloud gratis
> almudaya bot advisor
>
> # 2. Gunakan model lokal Ollama
> almudaya bot pull qwen2.5-coder:7b
> almudaya bot run --session S002 --bot BOT001 --provider ollama --model qwen2.5-coder:7b --mode review
>
> # 3. Gunakan NVIDIA NIM langsung + failover ke OpenRouter
> $env:NVIDIA_API_KEY="nvapi-xxxxxxxxxxxxxxxxxxxxxxxx"
> almudaya bot run --session S002 --bot BOT001 --provider nvidia --model nvidia/nemotron-3.5-super-vl-120b-a12b --failover openrouter:deepseek/deepseek-chat-v3-0324:free --mode review
> ```
> Di dalam REPL kapan saja, gunakan `/model recommend`, `/model pull qwen2.5-coder:7b`, `/model list nvidia`, atau `/model meta/llama-3.3-70b-instruct nvidia` untuk berganti model tanpa me-restart proses bot.

### 🖥️ Terminal 2 (Kanan): Jalankan Bot "Coder" di Mode TURBO

Buka jendela terminal kedua:
```powershell
$env:GEMINI_API_KEY="<YOUR_GEMINI_API_KEY>"
almudaya bot run --session S002 --bot BOT002 --provider gemini --mode turbo
```
Terminal 2 akan menampilkan prompt `Coder> `.

### 🚀 Langkah 6: Kirim Tugas Berbasis Skill AVDS dari Konsol "Architect" ke "Coder"

Di **Terminal 1 (`Architect> `)**, kirimkan pesan tugas langsung ke `Coder`:
```text
Architect> /msg Coder Tolong gunakan tool use_skill untuk membaca profil gaya 'quantum-futurism' dan platform 'web', lalu buatkan berkas 'src/theme-tokens.json' dan modul 'src/math.js' beserta pengujiannya dengan node.
```

Yang terjadi secara otonom di Terminal 2 (`Coder> `):
1. Bot **Coder** menerima pesan dengan *non-destructive TTY rendering*.
2. `AutonomousAgentLoop` menyuntikkan **PKU-First Reading Policy** dan konfigurasi **AVDS** ke dalam System Prompt Coder.
3. Coder memanggil **`query_pku_memory`** terlebih dahulu, lalu **`use_skill`** untuk membaca spesifikasi `quantum-futurism` dan `web`.
4. Coder memanggil **`write_file`** untuk menulis `src/theme-tokens.json` dan `src/math.js` (otomatis memperbarui indeks PKU inkremental), lalu memanggil **`run_command`** untuk menjalankan verifikasi `node`.
5. Seluruh mutasi tercatat di `work_log.jsonl` dan balasan dikirim kembali ke `Architect`.

### Langkah 7: Periksa Riwayat Kerja & Validasi Kontrak AVDS

Di **Terminal 1 (`Architect> `)**, periksa log lintas-root:
```text
Architect> /log
```
Untuk memvalidasi artefak kontrak desain AVDS dari CLI:
```powershell
almudaya skill validate D:\almudaya_multiagent_v0.1.0\skill\almudaya-visual-design\design-contract\examples\design-contract-example.json
```
Keluaran:
```text
AVDS Artifact Validation (design-contract): VALID ✅
```

### Langkah 8: Menghentikan Bot dengan Aman

Di masing-masing terminal bot (`Architect> ` dan `Coder> `), ketik:
```text
/exit
```
Kedua bot melakukan *graceful shutdown*, melepaskan lock dengan bersih, dan menyimpan jejak sesi pada Blackboard serta penyimpanan memori persisten PKU.
