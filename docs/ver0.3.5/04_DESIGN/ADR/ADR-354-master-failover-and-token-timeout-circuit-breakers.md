# ADR-354: Master Failover Chain (`PrMasterFailover`) and Timeout / Token Circuit Breakers

**Status:** ACCEPTED  
**Date:** 2026-11-15  
**Version:** v0.3.5  

---

## 1. Context

Jika seluruh tata kelola (`PrBot`, `PrIterasi`, `PrDE`, Goal Ledger, dan pembuatan rule *on-the-fly*) dipusatkan pada `MASTER` (`BOT000`), maka ketiadaan mekanisme perlindungan khusus pada otak AI milik `MASTER` akan menjadikannya *Single Point of Failure*. Jika API key Master terkena HTTP `402` atau *timeout* di tengah sesi, seluruh armada bot pekerja akan kehilangan wasitnya. Selain itu, diskusi antar-bot dapat menyedot kuota token besar sebelum batas hitungan pesan `10` tercapai.

---

## 2. Decision

1. **Kernel-Level `PrMasterFailover` (`FailoverAIProvider`):**
   - `MASTER` dijalankan di atas pembungkus `FailoverAIProvider` yang menyimpan `masterFailoverChain` (daftar pasangan `provider:model`).
   - Saat terjadi error non-retryable (`HTTP 402/401/403`), *rate limit* (`429`) melampaui batas tunggu wajar, atau `AbortError` *timeout* berkali-kali pada model aktif Master, `FailoverAIProvider` otomatis mengganti model aktif `MASTER` ke entry berikutnya dan mencatat kejadian ke `protocol/events.jsonl` **tanpa mereset Blackboard atau Goal Ledger**.
   - Jika seluruh rantai model cadangan juga gagal, sesi dijeda ke status `PAUSED_MASTER_UNAVAILABLE` dan langsung meminta arahan **HITL** di konsol utama.
2. **Pemutus Sirkuit Biaya & Waktu di Semua Protokol (`BudgetTracker`):**
   - Setiap tugas, utas `PrDE`, dan sesi secara keseluruhan tunduk pada dua batas keras di luar angka hitungan (`10`/`3`/`10`):
     - **Batas Waktu:** `taskTimeoutMs` (memicu `PrIterasi`) dan `threadTimeoutMs` (memicu `PrDE`).
     - **Batas Kuota Token:** `tokenBudget` diakumulasi dari `AIResponse.usage.totalTokens` (atau estimasi panjang karakter jika provider tidak mengembalikan `usage`). Mencapai `tokenBudget` langsung menjeda eksekusi dan memicu eskalasi ke **HITL** untuk otorisasi tambahan.

---

## 3. Consequences

- Sesi pengembangan otonom jangka panjang menjadi kebal terhadap gangguan tunggal satu provider AI (seperti insiden `Ollama Cloud 402` saat uji `QuantumLabs`).
- Risiko tagihan atau konsumsi token tak terkendali pada latar belakang tertahan oleh dua lapis pengaman: penghitung diskret (`PrBot`/`PrIterasi`/`PrDE`) DAN `BudgetTracker` berbasis waktu & token.
