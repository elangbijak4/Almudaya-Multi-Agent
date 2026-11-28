# Arsip & Jejak Dokumentasi Penggunaan (`USER/`) — Almudaya Multi-Agent

Direktori [`USER/`](./) berfungsi sebagai **repositori jejak sejarah penggunaan resmi** untuk **Almudaya Multi-Agent (`almudaya-multiagent`)**. Setiap kali rilis baru menghadirkan perubahan antarmuka CLI, protokol, alat, atau alur kerja operator, seluruh dokumen penggunaan versi baru ditambahkan ke dalam subdirektori berversi baru **tanpa pernah menghapus atau menimpa versi terdahulu**.

---

## 📜 Aturan Wajib Pembaruan Folder `USER/` (Append-Only Policy)

Setiap pembaruan versi `vX.Y.Z` yang memengaruhi penggunaan operator atau pengguna akhir **wajib** mengikuti protokol berikut:

1. **Larangan Penghapusan Arsip Lama:**  
   Jangan pernah menghapus, mengganti nama, atau mengubah isi subdirektori `USER/user_v*` versi sebelumnya (mis. `user_v0.1.0/`, `user_v0.3.0/`, `user_v0.3.5/`, `user_v0.3.7/`). Arsip lama harus tetap utuh untuk audit historis dan reproduksi sesi lama.
2. **Pembuatan Subdirektori Versi Baru (`USER/user_vX.Y.Z/`):**  
   Salin/perbarui paket dokumentasi pengguna lengkap ke folder baru `USER/user_vX.Y.Z/` berisi:
   - `USER_MANUAL.md` — Referensi teknis lengkap perintah CLI, opsi, slash command REPL, environment variables, serta skema tool runtime.
   - `USER_GUIDE.md` — Panduan konseptual, arsitektur proses, protokol koordinasi, tata kelola keamanan, dan filosofi sistem.
   - `USER_TUTORIAL.md` — Tutorial hands-on langkah demi langkah pembangunan proyek kolaboratif multi-bot.
   - `USER_TESTING.md` — Skenario pengujian siap-pakai langkah demi langkah menggunakan Windows Command Prompt (`cmd.exe`) mulai dari menyalakan aplikasi pertama kali (*cold start*).
3. **Sinkronisasi Salinan Aktif di Root Repositori:**  
   Setelah `USER/user_vX.Y.Z/` selesai disusun dan diverifikasi, salin keempat berkas terbaru tersebut ke root repositori (`../USER_MANUAL.md`, `../USER_GUIDE.md`, `../USER_TUTORIAL.md`, `../USER_TESTING.md`) sebagai penunjuk rilis aktif terkini.
4. **Pembaruan Indeks (`USER/README.md`):**  
   Tambahkan baris baru pada **Tabel Jejak Versi Penggunaan** di bawah ini yang mencatat perubahan kapabilitas penggunaan dan tautan lengkap ke berkas versi baru tersebut.

---

## 🗂️ Tabel Jejak Versi Penggunaan

| Versi Rilis | Subdirektori Arsip | Dokumen Tersedia | Tonggak Kapabilitas & Perubahan Penggunaan Utama |
| :--- | :--- | :--- | :--- |
| **`v0.1.0`** | [`user_v0.1.0/`](./user_v0.1.0/) | [`USER_MANUAL.md`](./user_v0.1.0/USER_MANUAL.md) · [`USER_GUIDE.md`](./user_v0.1.0/USER_GUIDE.md) · [`USER_TUTORIAL.md`](./user_v0.1.0/USER_TUTORIAL.md) | Fondasi awal Session Blackboard & Individual Blackboard, CLI inti (`session`, `context`, `bot`, `broadcast`, `message`), identitas stabil `BOTxxx`, tanpa orkestrator wajib (disalin utuh dari [`docs/docs_v0.1.0/08_OPERATIONS/`](../docs/docs_v0.1.0/08_OPERATIONS/)). |
| **`v0.3.0`** | [`user_v0.3.0/`](./user_v0.3.0/) | [`USER_MANUAL.md`](./user_v0.3.0/USER_MANUAL.md) · [`USER_GUIDE.md`](./user_v0.3.0/USER_GUIDE.md) · [`USER_TUTORIAL.md`](./user_v0.3.0/USER_TUTORIAL.md) | Interactive Bot Console REPL (`/msg`, `/broadcast`, `/peers`, `/roots`, `/log`, `/mode`), `AutonomousAgentLoop` ReAct + Gemini LLM, memori kerja lintas-root (`work_log.jsonl`), pemisahan 3 wilayah direktori (disalin utuh dari [`docs/docs_v0.3.0/`](../docs/docs_v0.3.0/)). |
| **`v0.3.5`** | [`user_v0.3.5/`](./user_v0.3.5/) | [`USER_MANUAL.md`](./user_v0.3.5/USER_MANUAL.md) · [`USER_GUIDE.md`](./user_v0.3.5/USER_GUIDE.md) · [`USER_TUTORIAL.md`](./user_v0.3.5/USER_TUTORIAL.md) | `almudaya up` (Unified HITL + Master Bot `BOT000`), 10 Protokol Atomic `IProtocol`, ACG Capability Governance, **PKU Unified Persistent Memory (Spec v0.2)**, **AVDS v1.0.1** (`use_skill`), serta Multi-Provider AI (`gemini`, `nvidia`, `openrouter`, `9router`, `ollama`, `mock`, Hardware Advisor). |
| **`v0.3.7`** *(Aktif)* | [`user_v0.3.7/`](./user_v0.3.7/) | [`USER_MANUAL.md`](./user_v0.3.7/USER_MANUAL.md) · [`USER_GUIDE.md`](./user_v0.3.7/USER_GUIDE.md) · [`USER_TUTORIAL.md`](./user_v0.3.7/USER_TUTORIAL.md) · [**`USER_TESTING.md`**](./user_v0.3.7/USER_TESTING.md) | Engine **`#Operation` (`almudaya.operation/v0.3`) & Dynamic Swarm Manifold** (`almudaya operation`, `almudaya up --operation`, `/operation`, Role Archetype $\mu_t$, `strict_distinct_bot` anti-affinity, worker apoptosis, kristalisasi *on-the-fly*), hardening `v0.3.6` (`masterStrictOrchestrator`, non-wildcard `PrModerator`, worker `--failover`, lease `180s`), dukungan penuh **`almudaya mcp`** & `/mcp`, koreksi preset ACG (`extended`), serta panduan uji **`USER_TESTING.md`** berbasis Windows `cmd.exe`. |

---

## 🔗 Tautan Cepat Versi Aktif (`v0.3.7`)

- 🧪 **Ingin langsung menguji multi-bot lewat `cmd.exe`?** Buka [`user_v0.3.7/USER_TESTING.md`](./user_v0.3.7/USER_TESTING.md) (atau [`../USER_TESTING.md`](../USER_TESTING.md)).
- 📖 **Butuh referensi perintah CLI & slash command REPL?** Buka [`user_v0.3.7/USER_MANUAL.md`](./user_v0.3.7/USER_MANUAL.md).
- 📘 **Mempelajari arsitektur `#Operation`, PKU, ACG, MCP, & AVDS?** Buka [`user_v0.3.7/USER_GUIDE.md`](./user_v0.3.7/USER_GUIDE.md).
- 📗 **Mengikuti tutorial langkah demi langkah?** Buka [`user_v0.3.7/USER_TUTORIAL.md`](./user_v0.3.7/USER_TUTORIAL.md).
