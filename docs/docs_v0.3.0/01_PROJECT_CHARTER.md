# Project Charter — Almudaya Multi-Agent v0.3.0

**Project:** Almudaya Multi-Agent  
**Target Version:** 0.3.0  
**Package:** `almudaya-multiagent`  
**Status:** DRAFT (Approved for Requirements Baseline)  
**Date:** 2026-11-03  

---

## 1. Visi (Vision)

Mentransformasikan pengalaman operasi bot Almudaya Multi-Agent menjadi **ekosistem konsol interaktif mandiri (*Interactive All-in-One Console*)** yang didukung oleh **memori kerja terpadu lintas-root (*Cross-Root Shared Work Memory*)**. Setiap terminal bot menjadi pusat kendali mandiri tempat operator dapat bercakap-cakap langsung dengan bot, mengarahkan instruksi ke bot lain, memantau rekan aktif, dan melihat linimasa kerja presisi berbasis lokasi (*location-aware*) di seluruh direktori kerja proyek target.

---

## 2. Sasaran (Objectives)

1. **Menghilangkan Freeze Terminal Bot:** Menggantikan loop polling pasif pada `almudaya bot run` dengan antarmuka **Interactive REPL Console** non-blocking yang tetap menjalankan detak heartbeat dan penerimaan pesan di latar belakang.
2. **Kendali Operator Alami & Terpadu (*All-in-One Control*):** Memungkinkan operator mengirim pesan ke bot lain (`/msg`), mengirim broadcast (`/broadcast`), memeriksa status rekan (`/peers`), mengecek root (`/roots`), melihat log (`/log`), dan mengubah mode keamanan (`/mode`) langsung dari terminal bot yang bersangkutan.
3. **Instruksi Langsung ke Bot Lokal:** Setiap teks bahasa alami yang diketik di konsol bot langsung menjadi pemicu (*turn input*) bagi bot lokal untuk berpikir, bernalar, dan mengeksekusi perkakas koding.
4. **Memori Sesi Berbasis Lokasi (*Cross-Root Session Work Log*):** Mencatat setiap mutasi berkas dan eksekusi perintah ke dalam `work_log.jsonl` dengan informasi lokasi presisi (`root_id`, `root_name`, `relative_path`, `action_type`, `summary`, `timestamp`).
5. **Orkestrasi Koding Lintas-Root:** Menginjeksikan ringkasan log kerja sesi ke dalam System Prompt AI dan menyediakan perkakas programmatic `get_work_log` bagi bot AI untuk saling memahami progres koding lintas root folder (misal: `frontend`, `backend`, `docs`).
6. **Perlindungan Tampilan Terminal:** Menerapkan teknik penataan rendering non-destruktif sehingga kedatangan pesan masuk dari Blackboard tidak merusak kursor ketikan operator yang sedang aktif.

---

## 3. Ukuran Keberhasilan (Success Measures)

1. Menjalankan `almudaya bot run` memunculkan prompt interaktif responsif (misal `Architect> `) tanpa memblokir input keyboard operator.
2. Operator dapat mengetik `/msg Coder "Tolong buatkan modul math.js"` di terminal Architect, dan pesan langsung terkirim serta dieksekusi oleh Coder.
3. Operator dapat mengetik instruksi langsung `Buatkan file index.html di root frontend`, dan bot lokal langsung mengeksekusi perintah tersebut.
4. Setiap aksi koding (penulisan berkas dan perintah shell) tercatat di `sessions/<id>/work_log.jsonl` lengkap dengan nama root, path relatif, dan timestamp.
5. Bot AI lain dapat membaca memori riwayat kerja tersebut baik via System Prompt maupun via perkakas `get_work_log`.
6. Pengujian unit, integrasi, dan end-to-end lulus 100% dengan mode pengujian offline (Mock Provider & Virtual TTY Stream).

---

## 4. Prinsip Desain (Design Principles)

- **Single Terminal Sovereignty:** Satu terminal adalah satu bot yang utuh, mandiri, dan berdaulat. Operator mengontrol ekosistem langsung melalui bot yang sedang ia ajak bicara.
- **Location-Aware Precision:** Operasi multi-root tidak boleh ambigu; setiap aksi koding harus terikat secara eksplisit pada identitas root proyek tertentu.
- **Non-Destructive UI Rendering:** Aliran notifikasi asynchronous dari Blackboard tidak boleh merusak teks input yang sedang diketik operator.
- **Strict Backward Compatibility:** Semua perintah CLI v0.1.0 dan v0.2.0 tetap berfungsi penuh tanpa perubahan yang merusak (*breaking changes*).

---

## 5. Batasan Cakupan v0.3.0 (Scope Boundaries)

### Dalam Cakupan (In Scope):
- Interactive Bot Console REPL Engine (`src/bot/console.ts`).
- Perintah internal konsol: `/msg`, `/broadcast`, `/peers`, `/roots`, `/log`, `/mode`, `/help`, `/clear`, `/exit`.
- Penerjemahan input non-slash sebagai instruksi langsung ke bot lokal.
- Shared Session Work Log Engine (`src/shared/work-log.ts`, `work_log.jsonl`).
- Skema `WorkLogEntry` dengan identitas root dan path relatif presisi.
- Injeksi otomatis riwayat kerja sesi ke System Prompt (`buildDynamicSystemPrompt`).
- Perkakas AI baru: `get_work_log` (membaca memori kerja session).
- Perluasan file tools & command tools untuk multi-root resolution.

### Di Luar Cakupan (Out of Scope):
- Web UI Dashboard berbasis browser (direncanakan untuk rilis visual terpisah).
- Remote network multi-machine clustering (fokus tetap pada multi-process lokal).
