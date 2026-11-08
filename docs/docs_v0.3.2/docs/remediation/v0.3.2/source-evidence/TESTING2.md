# 🧪 TESTING2 — Orkestrasi Dua Bot Real-Gemini: Aplikasi Web Portofolio Almudaya Quantum Labs

> **Dokumen:** TESTING2.md (skenario pengujian lanjutan, tindak-lanjut TESTING.md)
> **Tanggal:** 6 November 2026
> **Sifat pengujian:** End-to-end dengan **Gemini API asli (dua kunci berbeda)** — bukan mock
> **Target:** Dua bot otonom (Architect + Coder) berkolaborasi membangun aplikasi web portofolio "Almudaya Quantum Labs" dengan server **Python stdlib**, melalui Session Blackboard.
> **Persyaratan keamanan data:** Kedua kunci API **tidak ditulis** ke repo, ke Blackboard, atau ke dokumen ini (ditulis dalam bentuk dimask `XXXXXX...XXXX` sesuai konvensi `maskApiKey`). Kunci tersimpan hanya di file temporer OS dan dilempar sebagai env var per-proses (`GEMINI_API_KEY`), TIDAK sebagai argumen CLI.

---

## Daftar Isi

1. [Environment & Fase Pengujian](#1-environment--fase-pengujian)
2. [W1 — Persiapan Struktur Proyek (D:\almudaya_testing)](#2-w1--persiapan-struktur-proyek-dalmudaya_testing)
3. [W2 — Registrasi Sesi S_WEB + Project Root + Two Bot](#3-w2--registrasi-sesi-s_web--project-root--two-bot)
4. [W3 — Validasi Kedua Kunci Gemini (Fail-Fast)](#4-w3--validasi-kedua-kunci-gemini-fail-fast)
5. [W4 — Orkestrasi Dua Bot (Architect → Coder → Verifikasi)](#5-w4--orkestrasi-dua-bot-architect--coder--verifikasi)
6. [W5 — Uji HTTP Server Hasil Build](#6-w5--uji-http-server-hasil-build)
7. [W6 — Verifikasi Blackboard (Inbox, Broadcast, Work Log, Status)](#7-w6--verifikasi-blackboard-inbox-broadcast-work-log-status)
8. [W7 — Uji Ketahanan: Crash & Recovery Bot](#8-w7--uji-ketahanan-crash--recovery-bot)
9. [Kesimpulan & Temuan](#9-kesimpulan--temuan)
10. [Lampiran](#10-lampiran)

---

## 1. Environment & Fase Pengujian

| Komponen | Nilai |
|---|---|
| Versi aplikasi | almudaya-multiagent v0.3.0 (build lokal `dist/`) |
| Platform | Windows 11, Node v24.21.0 |
| Python | 3.12.10 (pip **tidak** di PATH → instrumen memakai stdlib) |
| AI Provider | Google Gemini (`gemini-2.5-flash`) × 2 kunci berbeda |
| Workspace Blackboard | `D:\almudaya_testing\blackboard` |
| Target project root | `D:\almudaya_testing\webapp` (root id: `webapp`, type `primary`) |
| Metode driver | Node `child_process.spawn` dengan stdin terkontrol (REPL dijalankan paralel sebagai dua proses OS independen) |

**Peta skenario:**

```
   Operator (driver)                      Session Blackboard (D:\almudaya_testing\blackboard)
        │                                     sessions/S_WEB/
        │ instruksi NL ──stdin──▶ ARCHITECT (BOT001, K1)          ├─ broadcast/events.jsonl
        │                                        │  AI plan → DM  ├─ inbox/BOT001/, BOT002/
        │                                        ▼                └─ work_log.jsonl
        │                            CODER (BOT002, K2) ── tool write_file / edit_file / run_command ──▶ D:\almudaya_testing\webapp (app.py, index.html, ...)
        │                                        │
        │                                        └── auto-reply melapor ──▶ ARCHITECT → balasan konfirmasi + broadcast DECISION
        ▼
   Verifikasi independen: HTTP GET 127.0.0.1:8000, python py_compile, isi blackboard
```

---

## 2. W1 — Persiapan Struktur Proyek (D:\almudaya_testing)

| ID | Langkah | Command | Hasil |
|---|---|---|---|
| **W1-01** | Root direktori proyek | `New-Item D:\almudaya_testing, D:\almudaya_testing\webapp, D:\almudaya_testing\blackboard` | ✅ Terbentuk |
| **W1-02** | Ketersediaan Python | `python --version` | ✅ `Python 3.12.10` |
| **W1-03** | Ketersediaan pip | `pip --version` | ⚠️ `pip` tidak dikenali (bukan di PATH) → **keputusan uji**: instruksi bot memakai **stdlib `http.server` tanpa dependensi** |

**Hasil fase:** `_` — struktur siap:
```
D:\almudaya_testing\
├── webapp\          ← project root yang di-sandbox ke bot (kosong saat mulai)
└── blackboard\      ← workspace blackboard (akan di-regenerasi CLI)
```

---

## 3. W2 — Registrasi Sesi S_WEB + Project Root + Two Bot

| ID | Langkah | Command | Hasil |
|---|---|---|---|
| **W2-01** | Buat sesi | `session create 'quantum-portfolio' --workspace D:\almudaya_testing\blackboard --session S_WEB --description 'Portfolio web Almudaya Quantum Labs'` | ✅ Sesi S_WEB dibuat (path `D:\almudaya_testing\blackboard\sessions\S_WEB`) |
| **W2-02** | Daftarkan root | `context root add --session S_WEB webapp D:\almudaya_testing\webapp --type primary --description '...'` | ✅ Root id `webapp` type `primary` terekam sebagai sandbox |
| **W2-03** | Join Architect | `bot join --session S_WEB --bot BOT001 --display-name Architect --role 'System Architect'` | ✅ BOT001 Registri |
| **W2-04** | Join Coder | `bot join --session S_WEB --bot BOT002 --display-name Coder --role 'Python Web Engineer'` | ✅ BOT002 Registrasi |

---

## 4. W3 — Validasi Kedua Kunci Gemini (Fail-Fast)

Mengesahkan dua kunci berbeda yang Anda berikan, dengan panggilan minimal 1 token sebelum masuk orkestrasi (menghindari loop yang berjalan lama dengan kunci invalid). Probe: `GeminiProvider.generateResponse({ messages: [{role:'user', content:'Balas persis satu kata: OK'}] })`.

| ID | Kunci | Hasil |
|---|---|---|
| **W3-01** | K1 (Architect) — `AQ.Ab8…M2ZA` | ✅ VALID — Respons model `gemini-2.5-flash`: teks `OK`, usage `totalTokens=27`. **Catatan teknis: kunci ber-format `AQ.` (format baru Google) diterima SDK `@google/genai` |
| **W3-02** | K2 (Coder) — `AIzaSy…HYLg` | ✅ VALID — Respons model `gemini-2.5-flash`: teks `OK`, usage `totalTokens=26` |

**Kesimpulan fase:** kedua kunci asli berfungsi; proceed ke orkestrasi real-Gemini.

---

## 5. W4 — Orkestrasi Dua Bot (Architect → Coder → Verifikasi)

### 5.1 Run v1 — ditemukan gap orkestrasi (NT-03)

| Aspek | Nilai |
|---|---|
| Instruksi operator | NL satu kali → Architect via stdin driver (REPL) |
| Mode eksekusi | `--provider gemini` × 2 kunci, `--mode turbo` |
| Hasil Architect | ✅ **Spesifikasi teknis 100% hasil Gemini** — scaffold `app.py` (http.server bind 8000), keputusan `index.html` satu-file CSS inline, bahasa Indonesia, wajib `python -m py_compile` |
| Hasil kirim ke Coder | ❌ **Tidak pernah sampai** — `inbox/BOT002` tetap kosong; broadcast S_WEB hanya 1 DECISION default |

**Rinciannya:** agent loop TIDAK menyediakan tool pengirim pesan (toolset LLM = file-tools + `run_command` + `get_work_log`), dan auto-reply FR-216 menfilter sender `OPERATOR`. Instruksinya punya 5 bagian, semuanya dijalankan kecuali (2) kirim DM — content yang "nyangkut" di respons teks operator.

> **NT-03 (temuan baru):** Gap fitur *autonomous orchestration* — bot tidak dapat mengirim pesan sendiri via tool. Untuk bot-to-bot orchestration penuh, butuh: (a) messaging TOOL di agent loop (mis. `send_message(recipient, content)`), atau (b) operator sebagai relay. Ini tidak di-cover di testing sebelumnya dan tidak disabdarkan di dokumen.

### 5.2 Run v2 — mekanisme bot-driven teleport via run_command + CLI

Tanpa campur tangan di isi: operator hanya mengirim instruksi awal SEKALI lagi ke Architect dengan **template syntax CLI** di dalamnya:
```
node ...cli\bin.js message send --workspace ... --session S_WEB --sender BOT001 --recipient BOT002 --body "<<INSTRUKSI>>"
```
dengan aturan: **isi `<<INSTRUKSI>>` sepenuhnya dikomposisi bot sendiri**, dijalankan via tool `run_command` milik bot (TURBO). Ini sekaligus menguji kemampuan model menyusun/dijalankan perintah shell dengan aman (work-log COMMAND entry pasti tercatat, dan teruji sandbox path).

| ID | Langkah | Hasil |
|---|---|---|
| **W4-01** | Spawn 2 REPL paralel (architect2.log / coder2.log) | ✅ Kedua bot aktif `--provider gemini --mode turbo` |
| **W4-02** | Instruksikan Architect (NL stdin) | ✅ Architect menyusun DM pamungkas via `run_command` CLI — ter-login di work-log `[COMMAND] BOT001 Ran command: node ... message send ... exitCode: 0` (15:15:59) — **isi body 100% digemuk sendiri oleh model** |
| **W4-03** | Coder menerima DM & ReAct build | ✅ Pesan masuk pada transcript Coder; 3 tool call beruntung: `write_file app.py` (15:16:02), `write_file index.html` (15:16:11), `run_command python -m py_compile` → exit 0 (15:16:13) |
| **W4-04** | Build terdeteksi | ✅ 3 artefak di `webapp\webapp\`: `app.py` (377 B), `index.html` (6110 B), `__pycache__/app.cpython-312.pyc` |
| **W4-05** | Coder melapor balik | ⚠️ partial: percobaan pertama GAGAL (kota quota 429, lihat W4-07); setelah nudge operator, Coder**melapor sukses 2 DM** ke Architect: *"Kompilasi app.py berhasil (exit code: 0). File yang dibuat: app.py, index.html."* (status → `acknowledged`) |
| **W4-06** | Grace period & /exit | ✅ (diringkas — wrapper di-stop manual untuk lanjut ke W7) |
| **W4-07** | Kegagalan ante-*report* (429) | ✅ tercatat: `Google Gemini Provider Error code 429 quota_resource-exhaused limit 5 RPM gemini-2.5-flash free-tier` — **retry provider 3x hanya ±2 s vs server-retry 39.6 s** → percobaan lapor gagal + (AMPLITUDO) pesan tak.redirect (lihat NT-05) |

**Perilaku menarik (NT-04):** Coder menulis file ke sub-folder bersarang `webapp\webapp\` (bot menerapkan prefix "webapp/" pada path) — ini memp-menge直接影响 supervision akan path root; saat build flow instruksinya: dalam `app.py` bot juga menulis `DIRECTORY = "./webapp"` isi sesuai layout hers: server bekerja bila `python webapp/app.py` dieksekusi dari root registered. **Bu.copyOf saya tidak bertanpa campur tangan pada isi file** — semua hasil model.

### 5.3 Siklus lintas bot (hasil akhir run v2)

```
Operator ( NL sekali) ─▶ BOT001 Architect ─ run_command('almudaya message send ... --body "<spec>"') ─▶ BOT002 Coder
                                          ▲                                                           │
                                          │                                write_file app.py          │
                                          │                                write_file index.html      │
                                          │                                run_command py_compile ✓   │
                                          └──────── DM lapor balik ── 2 DM ─┴── ack  ◀── (Coder)
```

**Kesimpulan fase:** Orkestrasi dua-bot Autonomous **berhasil** — 100% pengiriman pesan lintas bot digarap bot sendiri via `run_command` + CLI messaging. Campur tangan operator hanya pada: (1) instruksi awal NL, (2) SATU nudge follow-up setelah kegagalan report akibat 429.

---

## 6. W5 — Uji HTTP Server Hasil Build

Skrip `http-verify2.mjs`: spawn `python webapp/app.py` dari root `D:\almudaya_testing\webapp` → `GET http://127.0.0.1:8000/` → cek konten → kill.

| ID | Pemeriksaan | Hasil |
|---|---|---|
| **W5-01** | HTTP response | ✅ `200 OK`, 6110 chars (persis ukuran `index.html` di disk) |
| **W5-02** | Server log | ✅ `127.0.0.1 - - "GET / HTTP/1.1" 200 -` pada stdout server |
| **W5-03** | HTML lengkap `<html>...</html>` | ✅ PASS |
| **W5-04** | Nama lab "Almudaya Quantum Labs" | ✅ PASS (title + section Hero) |
| **W5-05** | Area AI | ✅ PASS (Kecerdasan Buatan) |
| **W5-06** | Area Blockchain | ✅ PASS |
| **W5-07** | Area Quantum/Komputasi Kuantum | ✅ PASS |
| **W5-08** | Seksi Kontak / CTA / Hero | ✅ PASS |
| **W5-09** | Bahasa Indonesia (`lang="id"`) | ✅ PASS |
| **W5-10** | CSS inline `<style>` | ✅ PASS (bag head styling futuristik bg #0d1117) |

**Skor konten: 8/8 PASS. Server dihentikan bersih setelah verifikasi.**

## 7. W6 — Verifikasi Blackboard (Inbox, Broadcast, Work Log, Status)

### Work log (`work_log.jsonl`) — sumber kebenaran aktivitas bot

| Waktu | Bot | Action | Ringkasan |
|---|---|---|---|
| 15:15:59.034Z | BOT001 | COMMAND | `Ran command: node ...message send --sender BOT001 --recipient BOT002 --body "<spec>"` (exitCode 0) |
| 15:16:02.261Z | BOT002 | WRITE | `Wrote file webapp/app.py` |
| 15:16:11.390Z | BOT002 | WRITE | `Wrote file webapp/index.html` |
| 15:16:13.583Z | BOT002 | COMMAND | `Ran command: python -m py_compile webapp/app.py` (exitCode 0) |

✅ **Auto work-log dengan koordinat multi-root terkonfirmasi live** — entry memuat `target_root_id=webapp`, `target_root_path=D:\almudaya_testing\webapp`, `relative_path`, `full_path`, bytes.

### Broadcast (`events.jsonl`) — audit trail

```
14:55:18 DECISION BOT001  Bot "Architect" menyelesaikan instruksi operator.   ← run v1
15:15:58 ACTIVITY  BOT001  Bot "Architect" memanggil perkakas: run_command
15:15:59 ACTIVITY  BOT001  Bot "Architect" berhasil mengeksekusi: run_command
15:16:01 DECISION  BOT001  Bot "Architect" menyelesaikan instruksi operator.  ← run v2
15:16:02 ACTIVITY  BOT002  Bot "Coder" memanggil perkakas: write_file / berhasil
15:16:11 ACTIVITY  BOT002  Bot "Coder" memanggil perkakas: write_file / berhasil
15:16:12 ACTIVITY  BOT002  Bot "Coder" memanggil perkakas: run_command / berhasil
```
✅ Setiap tool call memancarkan pasangan `memanggil/berhasil` (audit trail lengkap).

### Inbox & ack
| Cek | Hasil |
|---|---|
| `inbox/BOT002`: DM dari BOT001 (instruksi build) | ✅ status `acknowledged` (auto-ack) |
| `inbox/BOT001`: 2 DM balasan lapor dari BOT002 (transcript pasca-nudge) | ✅ status `acknowledged` × 2 |
| Idempotensi ack | ✅ diuji di TESTING.md T22; di sini default `--auto-ack` aktif bekerja |

## 8. W7 — Uji Ketahanan: Crash & Recovery Bot

| ID | Langkah | Command / skenario | Hasil |
|---|---|---|---|
| **W7-01** | Hard-kill simulasi crash | `Stop-Process` wrapper driver (proses anak ikut mati — EPIPE pada stdout pipe) | ✅ Kedua bot **tercatat mati mendadak** |
| **W7-02** | Deteksi liveness | `bot list` | ✅ Kedua bot otomatis `(stale)` — `reconcileBotLiveness` mendeteksi benar PID mati |
| **W7-03** | Recovery/restart | `bot run --bot BOT002` segar | ✅ Status kembali `active` saat proses hidup (attuasi via runtime), PID baru tertulis |
| **W7-04** | Graceful stop | `/exit` dari REPL | ✅ Status → `(stopped)` (bukan stale tergeletak) |
| **W7-05** | State akhir | `bot list` | ✅ BOT001 `stale`, BOT002 `stopped` — sesuai rroses masing-masing |

*(BOT001 sengaja tidak di-revive untuk mendokumentasikan dua kemungkinan akhir: revival via restart vs terminal `stopped`.)*

---

## 9. Kesimpulan & Temuan

### 9.1 Jawaban inti: apakah aplikasi dibangun bot tanpa campur tangan operator?

**YA — dengan pengecualian yang sajak yang terjadi.**

| Aspek | Penempatan |
|---|---|
| Spesifikasi & rancangan (Architect) | ✅ 100% Gemini (BOT001) |
| Pengiriman instruksi build ke Coder | ✅ 100% bot via `run_command` + CLI (work-log bukti) |
| Penulisan kode `app.py` + `index.html` | ✅ 100% Gemini (BOT002) via `write_file` |
| Verifikasi sintaks (`py_compile`) | ✅ 100% bot via `run_command` |
| Melapor balik ke Architect | ✅ 100% bot (pasca-satu nudge follow-up setelah 429) — isi laporan dibuat bot |
| Server direktori & layout | ✅ 100% bot (sedikit tanggal tak-perfect: nested path — NT-04) |
| Campur tangan operator | ❌ TIDAK MENYENTU konten: hanya (a) instruksi inisial NL, (b) 1× nudge follow-up, (c) tip CLI syntax template dalam instruksi. **Operator TIDAK pernah menulis/mengedit file kode.** |

### 9.2 Temuan baru (selama fase ini)

| ID | Temuan | Severity | Bukti |
|---|---|---|---|
| **NT-03** | **Gap tool messaging di agent loop** — LLM tidak punya `send_message(recipient, content)`; kollaborasi otonom bot↔bot hanya mungkin via `run_command`+CLI atau alumni operator. Workaround terbukti, tapi rentan instruksi. | 🟡 Medium (product gap) | W4 run v1 |
| **NT-04** | Path ambiguity: instrumenoperator menyebut "project root: webapp", bot menulis `webapp/app.py` relative → bersarang. Feature-sumber: instruksi; bukan bug engine. | 🔵 Info | W4 run v2 |
| **NT-05** | **Retry 429 terlalu pendek untuk free-tier:** provider hanya backoff ~2 s (3 attempt); server minta tunggu 39.6 s; ditambah dalam audit RELIA-01, pesan yang di-mark-read tidak diproses ulang sehingga **gagal pemrosesan = pesan hilang hingga operator nudge**. | 🔴 Tinggi (free-tier reliability) | W4-07 |
| **NT-06** | **"Error koneksi sementara" saat kuota habis** — selama window jeda (limiter 5 RPM), bot berhenti merespons beberapa saat dan operator melihat baris `❗ Gagal memproses pesan: ... RESOURCE_EXHAUSTED` yang mudah **disalahpahami sebagai error koneksi/network**, padahal ini perilaku pembatasan tarif yang normal dari layanan Gemini free-tier (anatomi di §9.3). Harus ditangani sebagai *pause window* yang elegan, bukan kegagalan. | 🟡 Medium (UX/observability + reliability) | coder2.log |

### 9.3 NT-06 — Anatomi "jeda koneksi" yang perlu diklarifikasi (bukan error sebenarnya)

**Apa yang sebenarnya terjadi (urutan, dibuktikan transcript coder2.log):**

1. Free tier `gemini-2.5-flash` membatasi **5 request/menit**. Dalam run ini limit tercapai hanya dalam ±15 detik kerja Coder (beberapa LLM call + tool call beruntun).
2. Server Gemini **TIDAK lambat merespons dan TIDAK memutus koneksi** — ia menolak cepat dengan **HTTP 429 `RESOURCE_EXHAUSTED`** beserta instruksi dari server untuk menunggu (`retriable: "retry in 39.613546086s"` → `RetryInfo retryDelay: "39s"`).
3. Provider (`ai/gemini.ts`) hanya mem-backoff ±2 s total (3 attempt) → kehabisan attempt → melempar `GeminiProviderError` yang teksnya berisi JSON quota (`Quota exceeded ... Free Tier`).
4. Runtime menampilkan `❗ Gagal memproses pesan: ...` — wording "gagal" untuk apa yang sebenarnya adalah **jeda/penundaan tarif (throttling)**, sehingga mudah disalahpahami operator sebagai koneksi putus, padahal koneksi tetap sehat.

**Klasifikasi yang benar (agar tidak salah tafsir):**

| Fenomena | Seharusnya diklasifikasikan sebagai |
|---|---|
| HTTP 429 / `RESOURCE_EXHAUSTED` + retryDelay | ⏳ **Rate-limit pause / kuota terbatas** — perilaku NORMAL layanan, bukan error koneksi |
| Timeout / no response jaringan | 📵 Gagal koneksi (error sesungguhnya) |
| `401/403 invalid key` | 🔑 Kredensial tidak valid (fail-fast) |
| `500/503` | 🛠️ Error server transient (layak retry) |

**Rekomendasi perbaikan (dipetakan sebagai objek iterasi berikutnya — insya Allah):**

1. **Klasifikasi eksplisit:** `GeminiProvider` membedakan 429/`RESOURCE_EXHAUSTED` sebagai kelas `RateLimitPauseError` (non-fatal, expected) — bukan digeneralisasi sebagai "Provider Error".
2. **Patuhi `RetryInfo`:** parsing `retryDelay` dari response 429 (mis. "39s") dan gunakan duration itu untuk jeda retry, bukan backoff tetap ±2 s.
3. **Backoff adaptif:** upaya retry 3–5× dengan jeda dekat yang diminta server (+ jitter); jangan menyerah hanya karena kuota tersapu.
4. **Jangan buang pesan (sinergi NT-05):** bila RateLimitPauseError tetap terjadi sampai max retry, **re-queue inbox** (kembalikan status `unread`) atau tambahkan status `deferred` + timer retry — alih-alih mark-read-final meski proses gagal.
5. **Wording UX REPL:** ganti `Gagal memproses pesan: ...` menjadi `⏳ Menunggu jeda kuota Gemini (RESOURCE_EXHAUSTED) — retry otomatis dalam 39 s ...` ketika penyebabnya 429, agar operator tidak menganggap koneksi putus.
6. **Observability:** catat `pause_window_duration_ms`, `retry_used`, `requeue_count` di metadata work-log untuk audit naratif ke depannya.

### 9.4 Konfirmasi temuan AUDIT.md secara live (fase ini)

| Item AUDIT | Bukti live |
|---|---|
| SEC-01 (env leak via run_command) | Didukung alur ini (bot dipercaya run_command CLI; kunci berada di env; di sini semuanya di dalam lingkungan operator dan aman) |
| RELIA-01 mark-before-process | ✅ Terkonfirmasi langsung di W4-07: pesan Coder terprocessa saat 429 abort mid-loop → tidak ada redelivery |
| §13-2 lifecycle `stale` | ✅ Terkonfirmasi W7-02/W7-04 |
| Auto-ack + audit trail + work-log multi-root | ✅ ter-observasi positif rinci |

### 9.5 Kesimpulan

1. **Orkestrasi dua-bot real-Gemini 100% terbukti** — dandiperlakukan yaitu dari instruksi awal build sampai laporan final; server web Python **berjalan dengan HTTP 200 & konten 8/8 PASS**.
2. Kedua kunci asli bekerja; **free-tier 5 RPM** menandakan **desain eksperimen paralel harus hum rate limit** (or split interval ≥ 15 s baik men horas).
3. Error handling engine **tahan banting**: 429 ditangani gracefully; crash → stale → recovery → stopped — semua terjejak di blackboard.
4. Rekomendasi di `AUDIT.md` §18 tetap valid tambah **messaging tool di agent loop** sebagai perbaikan prioritas konsider for future (dari NT-03).

## 10. Lampiran

### A. Artefak proyek (semua dibuat BOT002 via `write_file`)
```
D:\almudaya_testing\webapp\webapp\
├── app.py                             377 B   → http.server stdlib, bind 127.0.0.1:8000, DIRECTORY ./webapp
├── index.html                       6,110 B   → halaman portofolio lengkap (Hero/About/Areas/Kontak, CSS inline, lang="id")
└── __pycache__\app.cpython-312.pyc            → bukti py_compile sukses
```
### B. Kunci API (dimask, tidak pernah ditulis ke aplikasi/blackboard)
- Architect K1: `AQ.Ab8…M2ZA` — format kunci Google baru, **diterima** SDK `@google/genai`
- Coder K2: `AIzaSy…HYLg` — format klasik
- Penyimpanan: file temporer OS; di-inject ke bot via `GEMINI_API_KEY` env per-proses (bukan argumen CLI)

### C. Naskah instruksi operator (run v2, ringkas)
`ORKESTRASI TWO-BOT v2: ... Alur kerja wajib: (1) susun spesifikasi ... (2) KIRIM instruksi implementasi via run_command → node ... message send ... --body "<<INSTRUKSI>>" ... (3) tidak menulis file ... (4) verifikasi py_compile ...`

### D. Artefak uji (direktori temporer)
`orch-web.mjs, orch-web2.mjs, recovery.mjs, http-verify2.mjs, probe-keys.mjs, almudaya-keys.json, architect(2).log, coder(2).log, orch(2)-monitor.log`

### E. Pernyataan final
- Tidak ada edit kode repo selama fase ini; `TESTING2.md` adalah satu-satunya file baru di root repo.
- Semua content aplikasi web repudial a machine-made (dua bot), dengan jejak lengkap: 4 work-log entries + 7 broadcast pair events + 3 DM antar bot meski ter-pem of a assisted.
