# ADR-355: Protokol `PrMEend` (Message End & Task Migration) dan `PrBotGlobal` (Global Hardware/Token/Time Bot Ceiling)

**Status:** ACCEPTED  
**Date:** 2026-11-15  
**Version:** v0.3.5  

---

## 1. Context

Penelaahan lanjutan terhadap siklus *Macro-Loop* menemukan dua celah krusial yang tidak tertangani oleh **`PrBot`**, **`PrIterasi`**, maupun **`PrDE`**:

1. **Masalah Pesan Buntu & "Tugas 0" (*Silent Macro-Loop Death*):**
   Dalam *Macro-Loop*, setiap bot diwajibkan mengirim pesan lanjutan saat giliran atau tugasnya berakhir agar rantai kerja tetap berputar. Namun bot pekerja dapat mengalami dua kejadian:
   - Mengeluarkan pesan berisi **Tugas 0 (tidak ada lagi tugas lanjutan)** secara prematur meskipun tujuan proyek di **Goal Ledger** sebenarnya belum tuntas $\rightarrow$ *Macro-Loop* akan mati diam-diam.
   - Tidak mengetahui kepada bot siapa pesan tugas lanjutan harus dikirim, atau penerima tidak valid/tidak ada $\rightarrow$ terjadi kebuntuan alur (*orphaned handoff deadlock*).
2. **Master Bot Juga Memerlukan Batas Kapasitas Global:**
   `PrBot` membatasi kewenangan bot pekerja yang meminta dibuatkan bot baru (`<= 10`). Namun **`MASTER`** sendiri berhak membuat bot pengganti/spesialis secara internal ketika mengeksekusi `PrIterasi`, `PrDE`, maupun `PrMEend`. Tanpa plafon global yang membatasi **seluruh bot termasuk Master Bot**, sesi berisiko membuat RAM/CPU laptop penuh sesak, menyedot kuota token hingga habis, atau berjalan melampaui batas waktu proyek.

---

## 2. Decision

Menambahkan dua protokol kernel ke dalam **5 Protokol Bawaan v0.3.5**:

### 2.1 Protokol 4 — `PrMEend` (*Protocol Message End*)
1. **Kewajiban Pesan Keluar & Salinan ke Master (`CC: MASTER`):**
   - Setiap bot wajib menyertakan pesan tugas berikutnya (baik di tengah tugas maupun saat menyelesaikan tugas) sekaligus mengirim salinan pesan ke **`MASTER`** (dicatat di antrean audit `PrMEend` tanpa menambah hitungan *ping-pong* `PrDE`).
2. **Inspeksi Dua Lapis (*Two-Stage Inspection*):**
   - **Lapis 1 (Kernel Zero-Token Filter):** Kernel memvalidasi cepat setiap salinan pesan. Bila `recipient` ada & aktif dan payload bukan `TASK_0`, transaksi langsung diloloskan tanpa memanggil LLM Master (nol biaya token tambahan).
   - **Lapis 2 (Evaluasi AI Master Bot):** Bila terdeteksi (a) bot selesai tanpa mengirim pesan lanjutan, (b) `recipient` tidak diketahui / gagal resolusi / tidak cocok perannya, atau (c) pesan menyatakan `TASK_0` (tidak ada tugas lagi), maka `PrMEend` langsung mengaktifkan `MASTER` untuk:
     - **Migrasi Tugas:** Mengarahkan ulang pesan buntu tersebut ke bot yang semestinya mengerjakan.
     - **Spawn Bot Baru:** Membuat bot spesialis baru bila belum ada yang memenuhi (tetap patuh pada `PrBot` dan `PrBotGlobal`).
     - **Evaluasi Penutupan Macro-Loop:** Jika pesan bernilai `TASK_0`, `MASTER` mencocokkan status proyek dengan `goal_ledger.json`; jika benar tuntas, `MASTER` mengakhiri *Macro-Loop* secara resmi (`GOAL_ACHIEVED`), sebaliknya jika masih ada *acceptance criteria* terbuka, `MASTER` menolak `TASK_0` dan menyuntikkan tugas lanjutan.

### 2.2 Protokol 5 — `PrBotGlobal` (*Global Hardware, Token & Time Bot Ceiling*)
1. **Berlaku bagi Seluruh Bot Tanpa Pengecualian (Termasuk `MASTER`):**
   - Sebelum proses kelahiran bot baru mana pun dieksekusi—baik atas permintaan Worker (`PrBot`) maupun inisiatif **`MASTER`** (saat `PrIterasi`, `PrDE`, atau `PrMEend`)—kernel wajib memanggil `evaluateGlobalBotCeiling()`.
2. **Tiga Sumbu Evaluasi Global:**
   - **Spek Perangkat Keras Laptop/Komputer Berjalan:** Memanfaatkan modul `inspectHardware()` dari `src/ai/hardware-advisor.ts` (`v0.3.4`) dan `os.freemem()`/`os.cpus()` untuk menghitung plafon aman `hardwareSuggestedMaxBots` (atau nilai eksplisit `--pr-bot-global <n>`).
   - **Batasan Token Sesi:** Memeriksa sisa anggaran token (`tokenBudget - totalTokensUsed`).
   - **Batasan Waktu Global Sesi:** Memeriksa `globalTimeoutMs` (`number` dalam ms, **atau nilai `'infinite'`** agar sesi berjalan tanpa batas waktu jika diinginkan programmer).
3. **Eskalasi Wajib ke HITL:**
   - Setiap pelanggaran terhadap salah satu dari tiga sumbu di atas menahan proses pembuatan bot (meski jatah `PrBot` 10 bot belum habis) dan langsung melapor ke **Human-in-the-Loop (HITL)** untuk diputuskan (*matikan bot idle*, *lanjutkan dengan mode multiplexed*, *tambah anggaran/waktu*, atau *hentikan sesi*).

---

## 3. Consequences

- *Macro-Loop* tidak lagi dapat berhenti diam-diam karena `Tugas 0` prematur maupun gagal mencari penerima tugas (`PrMEend`).
- Beban LLM Master Bot tetap hemat karena `PrMEend` hanya membangunkan AI Master saat Lapis 1 mendeteksi anomali pesan (`UNKNOWN` / `MISSING_NEXT` / `TASK_0`).
- Kapasitas fisik laptop, kuota token, dan durasi global (`ms` atau `infinite`) terlindungi mutlak dari eskalasi bot yang tak terkendali oleh Worker maupun `MASTER` (`PrBotGlobal`).
