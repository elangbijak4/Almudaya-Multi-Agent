# Almudaya Multi-Agent v0.3.7 — Panduan Skenario Pengujian Multi-Bot Step-by-Step (`cmd.exe`)

> [!NOTE]
> Dokumen ini dirancang khusus untuk pengguna & penguji agar bisa langsung menjalankan **uji coba multi-bot langkah demi langkah menggunakan Windows Command Prompt (`cmd.exe`)** mulai dari **menghidupkan aplikasi pertama kali (*cold start*)** sampai verifikasi hasil. Seluruh contoh perintah menggunakan sintaks murni `cmd.exe` (`cd /d`, `set "KEY=VAL"`, `mkdir`, `start ... cmd /k`).

---

## Ringkasan Skenario Pengujian

| Skenario | Tujuan Uji | Kebutuhan AI / API Key | Perkiraan Waktu |
|---|---|---|---|
| **Tahap 0** | Cold start: menyalakan aplikasi, build CLI, cek versi & validasi `#Operation` | Tidak butuh API Key | 1–2 menit |
| **Skenario 1** | **Smoke Test End-to-End Multi-Bot & `#Operation`** di 1 jendela `cmd.exe` | Tidak butuh API Key (`--provider mock`) | 3 menit |
| **Skenario 2** | **Orkestrasi Dinamis Satu Perintah (`almudaya up`)**: `BOT000` + `#Operation` men-spawn worker & membubarkan worker otomatis (*apoptosis*) | 1 AI Provider aktif (`gemini` / `nvidia` / `ollama` / `openrouter`) | 5–10 menit |
| **Skenario 3** | **Kolaborasi Multi-Bot Manual di 3 Jendela `cmd.exe`** (AVDS `v1.0.1` + Human Review Gate + Uji Crash/Offline Inbox) | 1 atau 2 AI Key / Ollama lokal | 8–12 menit |
| **Skenario 4** | **Dynamic Swarm *On-the-Fly* (Tanpa Predefined `#Operation`) & Kristalisasi** | 1 AI Provider aktif | 5–8 menit |

> [!WARNING]
> **Aturan Emas `cmd.exe` (Wajib Diperhatikan Sebelum Mulai):**
> 1. Gunakan `cd /d D:\...` setiap kali berpindah drive (di `cmd.exe`, perintah `cd D:\...` saja dari drive `C:` **tidak** memindahkan direktori aktif!).
> 2. Set variabel API Key dengan pola **`set "NAMA_VAR=nilai_key"`** (tanda kutip mengapit `NAMA=nilai`). **JANGAN** menulis `set GEMINI_API_KEY="AIza..."`, karena `cmd.exe` akan memasukkan karakter tanda kutip `"` ke dalam API key Anda.

---

## TAHAP 0 — Menghidupkan Aplikasi Pertama Kali (Cold Start di `cmd.exe`)

### Langkah 0.1 — Buka Windows Command Prompt (`cmd.exe`)
1. Tekan **`Win + R`**, ketik **`cmd`**, lalu tekan **`Enter`**.
2. Pindah ke direktori engine Almudaya dan periksa Node.js & npm:
   ```cmd
   cd /d D:\almudaya_multiagent_v0.1.0
   node --version
   npm --version
   ```
   Pastikan `node --version` minimal **`v22.12.0`**.

### Langkah 0.2 — Build Aplikasi, Aktifkan Perintah `almudaya`, & Verifikasi Awal
Jalankan baris per baris di jendela `cmd.exe`:
```cmd
npm run build
npm link
almudaya --version
almudaya operation validate
```
**Tanda Aplikasi Siap Digunakan (`PASS`):**
- `npm run build` selesai tanpa galat TypeScript (`tsc`).
- `almudaya --version` mencetak **`0.3.7`**.
- `almudaya operation validate` mencetak **`All 7 Operation(s) PASSED static semantic validation (0 errors).`**.

> [!TIP]
> Bila `npm link` gagal karena izin administrator, seluruh perintah di bawah tetap bisa dijalankan tanpa instalasi global dengan mengganti `almudaya` menjadi `node D:\almudaya_multiagent_v0.1.0\dist\cli\bin.js` (atau jalankan `set "CLI=node D:\almudaya_multiagent_v0.1.0\dist\cli\bin.js"` lalu panggil `%CLI% ...`).

### Langkah 0.3 — Siapkan Folder Kerja Pengujian Terisolasi
Agar workspace utama Anda tidak tercampur data uji, buat dua folder terpisah (Blackboard uji dan proyek sasaran uji):
```cmd
mkdir D:\almudaya_test_ws
mkdir D:\almudaya_test_app
```

### Langkah 0.4 — Atur Kunci AI Provider (Hanya untuk Skenario 2, 3, & 4)
Pilih **salah satu** provider sesuai yang Anda miliki dan jalankan di `cmd.exe` yang sama **sebelum** menyalakan `almudaya up` atau `almudaya bot run`:

- **Opsi A — Google Gemini:**
  ```cmd
  set "GEMINI_API_KEY=ISI_API_KEY_GEMINI_ANDA"
  ```
- **Opsi B — NVIDIA NIM:**
  ```cmd
  set "NVIDIA_API_KEY=nvapi-ISI_API_KEY_NVIDIA_ANDA"
  ```
- **Opsi C — OpenRouter:**
  ```cmd
  set "OPENROUTER_API_KEY=sk-or-ISI_API_KEY_OPENROUTER_ANDA"
  ```
- **Opsi D — Ollama Lokal (Gratis Offline, pastikan server Ollama berjalan):**
  ```cmd
  set "OLLAMA_BASE_URL=http://localhost:11434/v1"
  ```

---

## SKENARIO 1 — Smoke Test Multi-Bot & `#Operation` Tanpa API Key (`--provider mock`)

Tujuan: Memastikan dalam **3 menit** (cukup 1 jendela `cmd.exe`, **tanpa biaya token / API key**) bahwa mesin sesi, Blackboard, `#Operation v0.3`, antrean pesan multi-bot, broadcast, dan `almudaya up --non-interactive` berjalan normal.

Salin dan jalankan perintah berikut **satu per satu** di `cmd.exe`:

### Langkah 1.1 — Buat Sesi, Daftarkan Project Root & Terapkan Izin ACG (`extended`)
```cmd
almudaya session create "Uji Smoke Multi-Bot" --session S_TEST_01 -w D:\almudaya_test_ws
almudaya context root add app-utama D:\almudaya_test_app --session S_TEST_01 --id app-utama --type primary -w D:\almudaya_test_ws
almudaya capability preset apply extended --session S_TEST_01 --paths D:\almudaya_test_app -w D:\almudaya_test_ws
```
**Output yang diharapkan:**
- `Session created successfully!` (`Session ID: S_TEST_01`)
- `Project root registered successfully!` (`Root ID: app-utama`, `Path: D:\almudaya_test_app`)
- `Preset "extended" applied successfully to session [S_TEST_01].` (`Generated 4 active capability grants.`)

### Langkah 1.2 — Inspeksi Katalog & Materialisasi `#Operation-looping` ke Sesi
```cmd
almudaya operation list
almudaya operation inspect #Operation-looping
almudaya operation apply #Operation-looping --session S_TEST_01 -w D:\almudaya_test_ws
```
**Output yang diharapkan:**
- `operation list` menampilkan `7` Operations (`01_emergent_bug_hunt`, `02_iterative_quality_loop`, `03_multi_hierarchy_manifold` + 3 child sub-operations, `04_research_pipeline`).
- `operation apply` mencetak `Applied Operation "almudaya.operation.looping@0.3.0" to session S_TEST_01` beserta jumlah `Seeded Tasks` dan `Dynamic Rules`.

### Langkah 1.3 — Daftarkan Dua Bot Kolaborator (`BOT001` & `BOT002`)
```cmd
almudaya bot join --session S_TEST_01 --bot BOT001 --name Architect --role "System Architect" -w D:\almudaya_test_ws
almudaya bot join --session S_TEST_01 --bot BOT002 --name Coder --role "Software Engineer" -w D:\almudaya_test_ws
almudaya bot list --session S_TEST_01 -w D:\almudaya_test_ws
```
**Output yang diharapkan:** Kedua bot (`BOT001` `"Architect"` dan `BOT002` `"Coder"`) terdaftar rapi di `S_TEST_01`.

### Langkah 1.4 — Uji Direct Message & Broadcast dari Operator ke Bot
```cmd
almudaya message send Coder "Siapkan struktur modul kalkulator" --session S_TEST_01 --sender HUMAN --type REQUEST -w D:\almudaya_test_ws
almudaya message read BOT002 --session S_TEST_01 --no-mark-read -w D:\almudaya_test_ws
almudaya broadcast publish "Arsitektur disetujui" --session S_TEST_01 --sender OPERATOR --category DECISION -w D:\almudaya_test_ws
almudaya broadcast read --session S_TEST_01 -w D:\almudaya_test_ws
```
**Output yang diharapkan:** Pesan `"Siapkan struktur modul kalkulator"` muncul di inbox `BOT002` dengan pengirim `HUMAN` (`status: unread` karena `--no-mark-read`), dan pengumuman `"Arsitektur disetujui"` terbaca pada log broadcast.

> [!NOTE]
> Sesuai mekanisme autentikasi pengirim **`AUD-10`**, CLI luar proses hanya mengizinkan `--sender BOT001` jika proses daemon `BOT001` benar-benar sedang hidup (`status: active`). Bila Anda baru menjalankan `bot join` + `bot list` tanpa menyalakan `bot run`, status bot otomatis terekonsiliasi menjadi `(stale)`, sehingga operator CLI mengirim pesan sebagai `--sender HUMAN` atau `--sender OPERATOR`.

### Langkah 1.5 — Uji Status Manifold, Evaluasi Predikat OBS, & Startup `almudaya up` Mode Mock
```cmd
almudaya operation status --session S_TEST_01 -w D:\almudaya_test_ws
almudaya operation evaluate --session S_TEST_01 -w D:\almudaya_test_ws
almudaya up --session S_TEST_UP --root D:\almudaya_test_app -w D:\almudaya_test_ws --provider mock --operation #Operation-emergentBugHunt --non-interactive
```
**Kriteria Lulus Skenario 1:**
- Seluruh 15 perintah keluar dengan kode status `0` (tanpa pesan `Error:`).
- `almudaya up --non-interactive` mencetak `Session ready: S_TEST_UP (...)`.

---

## SKENARIO 2 — Uji Multi-Bot Otonom Satu Perintah (`almudaya up` + `#Operation` Dynamic Swarm)

Tujuan: Mengamati **Master Bot (`BOT000`)** membaca `#Operation-looping`, menciptakan proses worker di jendela `cmd.exe` baru secara *real-time*, menegakkan pembagian peran (`developer` vs `test_engineer` pada proses bot terpisah sesuai aturan `anti_affinity: strict_distinct_bot`), menulis + menguji kode nyata ke `D:\almudaya_test_app`, dan membubarkan worker saat selesai (*apoptosis*).

> Pastikan Anda sudah menjalankan `set "API_KEY=..."` sesuai **Langkah 0.4** pada jendela `cmd.exe` Anda.

### Langkah 2.1 — Hidupkan Konsol Master + Swarm Manifold `#Operation-looping`
Pilih perintah sesuai AI provider Anda (contoh memakai **Gemini** — untuk NVIDIA gunakan `--provider nvidia --model nvidia/nemotron-3.5-super-vl-120b-a12b`, untuk Ollama gunakan `--provider ollama --model qwen2.5-coder:7b`):

```cmd
almudaya up --session S_SWARM_02 --root D:\almudaya_test_app -w D:\almudaya_test_ws --provider gemini --spawn-mode windows --operation #Operation-looping --turbo
```
*(Jika ingin mode jendela tunggal tanpa pop-up window tambahan, ganti `--spawn-mode windows` menjadi `--spawn-mode multiplexed`.)*

Anda akan masuk ke konsol interaktif **`HITL [MASTER]> `**.

### Langkah 2.2 — Periksa Keadaan Awal Manifold & Protokol di REPL
Ketik perintah slash berikut di prompt `HITL [MASTER]> `:
```text
/operation status
/protocol
/blueprint
/rules
```
Pastikan status `#Operation` menampilkan **`almudaya.operation.looping@0.3.0`** dengan `Regime: blueprint_seeded` (`hybrid`).

### Langkah 2.3 — Berikan Misi Multi-Agent ke Master Bot (`BOT000`)
Ketik instruksi bahasa alami berikut di prompt `HITL [MASTER]> ` dan tekan `Enter`:
```text
Buatkan aplikasi CLI mini kalkulator ilmiah pada root D:\almudaya_test_app: minta worker ber-role_archetype developer membuat src/calculator.js (fungsi add, subtract, multiply, divide dengan guard pembagian nol), lalu minta worker terpisah ber-role_archetype test_engineer membuat tests/calculator.test.js menggunakan node:test serta menjalankannya. Tutup setiap tugas jika tes 100% PASS.
```

### Langkah 2.4 — Hal yang Diamati Selama Eksekusi Multi-Bot
1. `BOT000` memanggil `create_goal_blueprint`, menerbitkan `CapabilityToken` disjoin per tugas (`src/calculator.js` dan `tests/calculator.test.js` — non-wildcard `PrModerator`), lalu memanggil `spawn_worker_bot` dengan `role_archetype: "developer"`.
2. **Jendela `cmd.exe` Worker #1 (`developer`) terbuka otomatis** (jika `--spawn-mode windows`), mengimplementasikan `src/calculator.js`, memanggil `update_goal_task(status="DONE")` dan `submit_task_handoff`.
3. `BOT000` men-spawn **Worker #2 (`test_engineer`)** pada bot ID berbeda (menegakkan `anti_affinity: strict_distinct_bot`, tidak mendaur ulang worker pembuat kode).
4. **Jendela `cmd.exe` Worker #2 (`test_engineer`)** menulis `tests/calculator.test.js`, menjalankan `node --test`, menandai tugas `DONE`, dan worker mengalami *apoptosis* saat tugas rampung.
5. `BOT000` memanggil `mark_goal_achieved` untuk melewati gerbang `PrGate`.

### Langkah 2.5 — Inspeksi Hasil Akhir & Keluar Aman
Masih di `HITL [MASTER]> `, jalankan:
```text
/bots
/operation status
/operation evaluate
/log
/exit
```
Lalu di `cmd.exe` biasa, verifikasi fisik berkas & hasil tes secara independen:
```cmd
dir /s /b D:\almudaya_test_app
node --test D:\almudaya_test_app\tests\calculator.test.js
```
**Kriteria Lulus Skenario 2:**
- `src\calculator.js` dan `tests\calculator.test.js` tercipta di `D:\almudaya_test_app`.
- `node --test` mengembalikan **`0` fail** dan seluruh tes PASS.
- `/operation status` merekam riwayat realisasi role terpisah antara `developer` dan `test_engineer`.

---

## SKENARIO 3 — Uji Kolaborasi Manual 3 Jendela `cmd.exe` (AVDS + Review Gate + Uji Crash/Offline)

Tujuan: Menguji kolaborasi *peer-to-peer* tanpa `BOT000`, kontrol manusia pada **Review Gate (`--mode review`)**, pemakaian **Skill AVDS v1.0.1 (`use_skill`)**, serta **ketahanan antrean pesan saat bot mati (*offline / crash*)**.

### Langkah 3.1 — Siapkan Sesi & Konteks dari Jendela CMD #1 (Operator)
Di **Jendela CMD #1**:
```cmd
cd /d D:\almudaya_multiagent_v0.1.0
almudaya session create "Kolaborasi Manual 3 Bot" --session S_MANUAL_03 -w D:\almudaya_test_ws
almudaya context root add web-ui D:\almudaya_test_app --session S_MANUAL_03 --id web-ui --type primary -w D:\almudaya_test_ws
almudaya capability preset apply extended --session S_MANUAL_03 --paths D:\almudaya_test_app -w D:\almudaya_test_ws
almudaya skill enable avds --session S_MANUAL_03 --style quantum-futurism --platform web --modalities keyboard mouse-pointer --entry-point full-cycle -w D:\almudaya_test_ws
almudaya bot join --session S_MANUAL_03 --bot BOT001 --name Architect --role "UI & System Architect" -w D:\almudaya_test_ws
almudaya bot join --session S_MANUAL_03 --bot BOT002 --name Coder --role "Frontend Engineer" -w D:\almudaya_test_ws
almudaya bot join --session S_MANUAL_03 --bot BOT003 --name QA --role "Quality Verifier" -w D:\almudaya_test_ws
```

### Langkah 3.2 — Buka Jendela CMD #2 (`Architect`, Mode `review`) dan Jendela CMD #3 (`Coder`, Mode `turbo`)
Masih dari **Jendela CMD #1**, Anda dapat langsung membuka dua jendela `cmd.exe` terpisah memakai perintah `start` (ganti `GEMINI_API_KEY` dan `--provider gemini` sesuai provider Anda):

**Membuka Jendela CMD #2 (`BOT001 Architect`):**
```cmd
start "CMD 2 - BOT001 Architect" cmd /k "cd /d D:\almudaya_test_app && set "GEMINI_API_KEY=%GEMINI_API_KEY%" && almudaya bot run --session S_MANUAL_03 --bot BOT001 --provider gemini --mode review -w D:\almudaya_test_ws"
```

**Membuka Jendela CMD #3 (`BOT002 Coder`):**
```cmd
start "CMD 3 - BOT002 Coder" cmd /k "cd /d D:\almudaya_test_app && set "GEMINI_API_KEY=%GEMINI_API_KEY%" && almudaya bot run --session S_MANUAL_03 --bot BOT002 --provider gemini --mode turbo -w D:\almudaya_test_ws"
```

*(Opsional)* Buka **Jendela CMD #4 (`BOT003 QA`)** bila ingin melibatkan bot ke-3 secara langsung.

### Langkah 3.3 — Jalankan Kolaborasi & Uji Human Review Gate
1. Di **Jendela CMD #2 (`Architect> `)**, verifikasi peer dan skill terlebih dulu:
   ```text
   /peers
   /skill list
   ```
2. Masih di **Jendela CMD #2 (`Architect> `)**, ketik instruksi langsung agar `Architect` membuat ringkasan desain lalu mengirim tugas ke `Coder`:
   ```text
   Gunakan use_skill untuk membaca gaya 'quantum-futurism' dan platform 'web', tulis ringkasan desain singkat ke docs/DESIGN_NOTES.md pada D:\almudaya_test_app, lalu gunakan send_message ke BOT002 agar membuat halaman dashboard/index.html yang rapi.
   ```
3. Ketika `Architect` ingin menulis `docs/DESIGN_NOTES.md`, karena berjalan di `--mode review`, terminal CMD #2 akan menampilkan permintaan persetujuan manusia (`[REVIEW REQUIRED]`):
   - Ketik **`y`** lalu `Enter` untuk menyetujui penulisan file. *(Atau coba ketik `n` terlebih dahulu untuk memverifikasi bahwa penolakan memblokir penulisan ke disk!)*
4. Perhatikan **Jendela CMD #3 (`Coder> `)**: `Coder` langsung menerima DM dari `Architect`, membaca `work_log` / `PKU`, lalu menulis `dashboard/index.html` secara otonom.

### Langkah 3.4 — Sub-Uji Ketahanan Offline / Crash Recovery
Uji apakah pesan tidak pernah hilang ketika salah satu bot terhenti:
1. Di **Jendela CMD #3 (`Coder> `)**, hentikan bot dengan mengetik `/exit` (atau simulasikan crash dengan **`Ctrl+C`**).
2. Di **Jendela CMD #2 (`Architect> `)**, kirim pesan ke `Coder` saat `Coder` sedang mati:
   ```text
   /msg Coder Tolong tambahkan footer versi 0.3.7 ke file dashboard/index.html dan beri tahu saya jika sudah selesai.
   ```
3. Di **Jendela CMD #3** (jendela `Coder` yang tadi mati), hidupkan ulang `Coder`:
   ```cmd
   almudaya bot run --session S_MANUAL_03 --bot BOT002 --provider gemini --mode turbo -w D:\almudaya_test_ws
   ```
4. **Kriteria Lulus Sub-Uji Crash/Offline:** Dalam beberapa detik setelah hidup kembali, `BOT002 Coder` otomatis mengambil pesan yang tertunda dari inbox `S_MANUAL_03`, memperbarui `dashboard/index.html`, dan membalas `Architect`.
5. Akhiri semua jendela bot dengan `/exit`.

---

## SKENARIO 4 — Dynamic Swarm *On-the-Fly* (Tanpa Predefined `#Operation`) & Kristalisasi `#Operation` Baru

Tujuan: Menguji skenario di mana **belum ada `#Operation` yang dipilih di awal** (`almudaya up` polos), lalu `BOT000` menyintesis topologi swarm dinamis secara *on-the-fly* (`synthesize_operation`) dan hasilnya dibekukan (*crystallize*) menjadi paket `#Operation v0.3` permanen yang dapat dipakai ulang.

### Langkah 4.1 — Jalankan `almudaya up` Tanpa `--operation`
```cmd
almudaya up --session S_ADHOC_04 --root D:\almudaya_test_app -w D:\almudaya_test_ws --provider gemini --spawn-mode multiplexed --turbo
```

### Langkah 4.2 — Perintahkan `BOT000` Menyintesis `#Operation` Baru Secara Real-Time
Di prompt `HITL [MASTER]> `, masukkan instruksi berikut:
```text
Belum ada #Operation yang aktif pada sesi ini. Panggil tool synthesize_operation untuk merancang manifold dinamis bernama "Audit Keamanan Kode Mini" (regime: blueprint_seeded, topology_shape: pipeline), buat blueprint 2 langkah untuk mengaudit semua berkas di D:\almudaya_test_app ke laporan AUDIT_REPORT.md oleh worker security_auditor, dan tutup tugas setelah laporan selesai dibuat.
```
Amati output konsol bahwa `BOT000` memanggil `synthesize_operation`, men-spawn worker sesuai peran hasil sintesis, dan menuntaskan `AUDIT_REPORT.md`.

### Langkah 4.3 — Bekukan (*Crystallize*) Manifold Menjadi Paket `#Operation` Permanen & Validasi
Di prompt `HITL [MASTER]> `, jalankan:
```text
/operation status
/operation crystallize almudaya.operation.audit-mini
/exit
```
Lalu di `cmd.exe`, validasi paket `#Operation` yang baru lahir dan lihat ia muncul di katalog workspace Anda:
```cmd
almudaya operation validate almudaya.operation.audit-mini -w D:\almudaya_test_ws
almudaya operation list -w D:\almudaya_test_ws
```
**Kriteria Lulus Skenario 4:**
- `almudaya operation validate` mencetak `Operation almudaya.operation.audit-mini is VALID (0 errors).`.
- `almudaya operation list -w D:\almudaya_test_ws` menampilkan **`almudaya.operation.audit-mini`** sehingga bisa langsung dipanggil ulang pada proyek masa depan dengan `--operation almudaya.operation.audit-mini`.

---

## Checklist Evaluasi Pengujian Lengkap

| Item Uji | Skenario Terkait | Cara Cek di `cmd.exe` / REPL | Status |
|---|---|---|---|
| CLI `v0.3.7` & Validasi 7 `#Operation` Bawaan | Tahap 0 | `almudaya --version` & `almudaya operation validate` | [ ] PASS |
| Sesi, Root, Preset ACG `extended`, DM, Broadcast, `mock` | Skenario 1 | Semua 15 perintah exit `0` | [ ] PASS |
| Dynamic Swarm `BOT000` + `anti_affinity` + *Apoptosis* | Skenario 2 | `node --test D:\almudaya_test_app\tests\calculator.test.js` PASS | [ ] PASS |
| Multi-Terminal Peer-to-Peer, AVDS `use_skill`, Review Gate | Skenario 3 | `/mode review` menahan mutasi sampai dijawab `y` | [ ] PASS |
| Ketahanan Offline / Crash Recovery | Skenario 3.4 | Pesan terkirim saat `BOT002` mati tetap dieksekusi saat restart | [ ] PASS |
| *On-the-Fly* `synthesize_operation` & `crystallize` | Skenario 4 | `almudaya operation validate almudaya.operation.audit-mini` = VALID | [ ] PASS |

---

## Pembersihan & Troubleshooting Cepat `cmd.exe`

### Membersihkan Lingkungan Uji untuk Pengujian Ulang dari Nol
```cmd
rmdir /s /q D:\almudaya_test_ws
rmdir /s /q D:\almudaya_test_app
mkdir D:\almudaya_test_ws
mkdir D:\almudaya_test_app
```

### Masalah Umum pada `cmd.exe`
1. **Error `'almudaya' is not recognized as an internal or external command`:**
   - Jalankan `npm link` di `D:\almudaya_multiagent_v0.1.0`, **atau** panggil `node D:\almudaya_multiagent_v0.1.0\dist\cli\bin.js <subcommand>`.
2. **Error API Key invalid (401/403) padahal key benar:**
   - Anda kemungkinan menulis `set GEMINI_API_KEY="AIza..."` di CMD. Ulangi dengan tanda kutip di luar pasangan: `set "GEMINI_API_KEY=AIza..."`.
3. **Worker tidak dapat menulis berkas (`CAPABILITY_DENIED` atau `PrModerator DENY`):**
   - Pastikan Anda sudah mendaftarkan project root (`context root add` / `--root`) serta menerapkan preset **`extended`** dengan `--paths D:\direktori_target`, dan saat memakai `almudaya up`, biarkan `BOT000` menerbitkan `CapabilityToken` terlebih dahulu ke path target konkret worker.
4. **Rate Limit (`429`) pada model gratis:**
   - Gunakan flag `--master-failover` pada `almudaya up` atau `--failover` pada `almudaya bot run`, atau pindah langsung saat runtime lewat `/model <modelId> <provider>` di dalam REPL.
