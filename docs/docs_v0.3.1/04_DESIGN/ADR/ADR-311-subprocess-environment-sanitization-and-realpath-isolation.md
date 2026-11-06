# ADR-311: Subprocess Environment Sanitization & Canonical Realpath Filesystem Isolation

- **Status:** APPROVED
- **Date:** 2026-11-06
- **Deciders:** System Architect, Quality Auditor, Lead Developer
- **Consulted:** SRS v0.3.1 (FR-319, FR-320, NFR-306, NFR-307)
- **Resolves:** `SEC-01` (Child process environment leak) & `§14/6` (Sandbox symlink/junction escape)

---

## 1. Konteks & Masalah

Hasil evaluasi pada [`AUDIT.md`](file:///d:/almudaya_multiagent_v0.1.0/AUDIT.md) dan pengujian live pada [`TESTING.md`](file:///d:/almudaya_multiagent_v0.1.0/TESTING.md) menemukan dua celah keamanan kritis pada perkakas koding:

1. **`SEC-01` (Pewarisan Kredensial via `run_command`):**
   Fungsi `child_process.exec` di `src/tools/sandbox.ts` mewarisi seluruh `process.env` dari proses induk. Dalam pengujian **T-SEC-11**, perintah `echo %GEMINI_API_KEY%` berhasil menampilkan nilai sentinel token rahasia ke stdout. Nilai ini kemudian terekam ke `work_log.jsonl` dan broadcast event publik, melanggar **Invariant 7**.
2. **`§14/6` (Pelarian Sandbox via Symlink / Windows Directory Junction):**
   Fungsi `assertWithinRoot` hanya melakukan pencocokan string leksikal (`path.resolve`). Dalam pengujian **T-SEC-12**, pembuatan Windows Directory Junction (`mklink /J`) di dalam project root yang mengarah ke direktori di luar root memungkinkan bot membaca dan memanipulasi berkas di luar sandbox secara penuh, melanggar **Invariant 5**.

---

## 2. Keputusan yang Diambil

1. **Implementasi Sanitasi Lingkungan Subprocess (`sanitizeChildEnv`):**
   - Menghapus pewarisan implisit `process.env`.
   - Menggunakan pendekatan **Strict Allowlist + Sensitive Pattern Purge**:
     - *Allowlist:* Hanya meneruskan variabel OS esensial yang diperlukan untuk menjalankan binary kompilator (misal `PATH`, `SYSTEMROOT`, `COMSPEC`, `TEMP`, `USERPROFILE`, `PYTHONPATH`, dll.).
     - *Purge:* Menghapus secara agresif semua variabel yang mengandung substring `KEY`, `SECRET`, `TOKEN`, `AUTH`, `PASS`, atau `CREDENTIAL`.
   - Menjamin proses anak tidak dapat mengakses `GEMINI_API_KEY` atau token rahasia lainnya.

2. **Resolusi Path Kanonikal Fisik (`fs.realpathSync`):**
   - Memperbarui fungsi `assertWithinRoot` untuk menyelesaikan seluruh symlink, junction, dan hardlink ke path fisik kanonikal sebelum memverifikasi batas direktori root.
   - Jika berkas target belum ada di disk (skenario pembuatan berkas baru pada `write_file`), sistem menyelesaikan direktori induk terdekat yang sudah ada (`canonicalParent`) dan menggabungkannya dengan nama berkas baru.
   - Seluruh project root terdaftar juga diselesaikan menggunakan `fs.realpathSync`.
   - Menolak dengan error `Access denied` jika path kanonikal target berada di luar path kanonikal seluruh root terdaftar.

3. **Penyaringan Redaksi Output Log:**
   - Memastikan bahwa setiap output perintah shell yang dipangkas menjadi `stdout_snippet` atau `stderr_snippet` di `work_log.jsonl` disaring melalui fungsi redaksi rahasia untuk mencegah kebocoran tidak disengaja.

---

## 3. Konsekuensi

- **Positif:**
  - Invariant 5 (Sandbox Boundary) dan Invariant 7 (Credential Privacy) terjamin 100% di level kernel OS dan filesystem fisik.
  - Perintah koding di dalam sandbox tetap dapat menjalankan utilitas standar (Node, Python, git, npm) secara normal karena variabel path OS esensial tetap disediakan.
- **Negatif / Mitigasi:**
  - *Performa realpath:* Pemanggilan `fs.realpathSync` menambah operasi I/O kecil pada sistem berkas.
  - *Mitigasi:* Operasi berkas bot terjadi pada skala ratusan milidetik (terikat latensi inferensi AI), sehingga penambahan latensi I/O sub-milidetik dari `realpathSync` tidak terasa sama sekali.
  - *Kebutuhan tool koding yang membutuhkan env tertentu:* Jika skrip koding membutuhkan variabel lingkungan khusus (misal `PORT=8000`), skrip tersebut dapat menyediakannya secara inline saat eksekusi perintah (misal `PORT=8000 python app.py`).
