# Almudaya Multi-Agent — User & Operator Guide

Panduan konseptual dan operasional komprehensif untuk pengembang, arsitek sistem, dan operator yang mengelola lingkungan kolaborasi multi-agent dengan Almudaya Multi-Agent (`almudaya-multiagent` v0.1.0).

---

## 1. Filosofi & Arsitektur Sistem

Almudaya dirancang untuk mengatasi kelemahan arsitektur agen tradisional yang memusatkan semua agen ke dalam satu proses monolitik (*single-process loop*). Almudaya mengadopsi prinsip **Session-Centric**, **Multi-Process**, dan **Persistent Blackboard**.

```text
                      ┌───────────────────────────────────────────────┐
                      │              Session Blackboard               │
                      │         (sessions/<session_id>/)              │
                      │                                               │
                      │  ┌──────────────────────────────────────────┐ │
                      │  │ Bot Registry (bots.json)                 │ │
                      │  ├──────────────────────────────────────────┤ │
                      │  │ Broadcast Event Stream (events.jsonl)    │ │
                      │  ├──────────────────────────────────────────┤ │
                      │  │ Shared Project Context (context.json)    │ │
                      │  └──────────────────────────────────────────┘ │
                      │  ┌──────────────────────────────────────────┐ │
                      │  │ Individual Inboxes (inbox/<bot_id>/)     │ │
                      │  │ - messages.json                          │ │
                      │  │ - cursors.json                           │ │
                      │  └──────────────────────────────────────────┘ │
                      └──────────────────────▲────────────────────────┘
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       │                                           │
          ┌────────────┴─────────────┐                ┌────────────┴─────────────┐
          │  Bot Process 1 (Node.js) │                │  Bot Process 2 (Node.js) │
          │  - Bot ID: BOT001        │                │  - Bot ID: BOT002        │
          │  - Display: "Architect"  │                │  - Display: "Engineer"   │
          │  - OS Process / PID: 1204│                │  - OS Process / PID: 1205│
          └──────────────────────────┘                └──────────────────────────┘
```

### Empat Pilar Arsitektur:
1. **Session Boundary (Batas Kolaborasi):** Setiap proyek kolaborasi dibatasi dalam sebuah *Session*. Data antar-session terisolasi total secara fisik.
2. **Process Isolation (Isolasi Proses OS):** Setiap bot berjalan di proses Node.js masing-masing. Jika satu bot mengalami crash, infinite loop, atau memakan CPU tinggi, bot lain dan session tetap berjalan normal tanpa terganggu.
3. **Blackboard Durability (Persistensi Mutlak):** Semua status, pesan, dan event disimpan ke disk menggunakan penulisan atomik dan *locking* kooperatif. Seluruh riwayat tetap utuh meski sistem mati atau di-*restart*.
4. **Decentralized Coordination:** Tidak ada bot "dewa" atau *supervisor* wajib. Bot berkoordinasi secara otonom melalui broadcast dan pesan langsung di Blackboard.

---

## 2. Pemisahan Penting: Tiga Wilayah Direktori

Salah satu aspek paling penting yang harus dipahami oleh pengguna adalah pemisahan antara **tiga entitas direktori**:

```text
┌───────────────────────────────────────┐
│ 1. Engine Almudaya (Source Code)      │ -> D:\almudaya_multiagent_v0.1.0\
│    - Tempat kode engine disimpan.    │    (src, package.json, tests, docs)
└───────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│ 2. Session Blackboard (Data Runtime)  │ -> %LOCALAPPDATA%\almudaya\sessions\S001\
│    - Tempat Blackboard & Inbox hidup. │    (Atau via flag --workspace D:\Workspaces)
└───────────────────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│ 3. Target Proyek yang Digarap Agen    │ -> D:\Projects\TokoOnline\
│    - Kode aplikasi yang dikerjakan.   │    (Didaftarkan via: almudaya context root)
└───────────────────────────────────────┘
```

1. **Direktori Engine Almudaya (`D:\almudaya_multiagent_v0.1.0`):** Berisi kode sumber framework ini. Direktori ini tidak boleh dan tidak akan pernah dikotori oleh data sesi kerja Anda.
2. **Direktori Session Blackboard Workspace:** Secara default berada di folder data sistem (`%LOCALAPPDATA%\almudaya` di Windows). Anda bebas memindahkannya ke mana pun dengan flag `--workspace <path>` atau variabel `$env:ALMUDAYA_WORKSPACE`.
3. **Direktori Target Proyek (Codebase yang Dikerjakan):** Proyek perangkat lunak yang sedang Anda bangun bersama agen (misal proyek web di `D:\MyWebProject`). Proyek ini dihubungkan ke session menggunakan perintah `almudaya context root add`.

---

## 3. Aturan Identitas & Penamaan Bot (Identity Invariant)

Untuk mencegah ambiguitas komunikasi antar-agen, Almudaya menerapkan aturan identitas ganda:

1. **Bot ID Stabil (Imutabel):**
   - Format: `BOT001`, `BOT002`, dst.
   - Bersifat permanen seumur hidup bot di dalam session tersebut.
   - Digunakan sebagai kunci unik folder inbox (`inbox/BOT001/`) dan referensi riwayat pesan masa lalu.
2. **Display Name (Nama Tampilan yang Manusiawi):**
   - Contoh: `"System Architect"`, `"Frontend Developer"`.
   - Dapat diubah kapan saja menggunakan perintah `almudaya bot rename`.
   - **Wajib unik dalam satu Session** untuk mencegah salah kirim pesan.
   - Jika saat pendaftaran pengguna tidak menentukan nama, sistem membuatkan nama default deterministik: `<session>_<seq>` (misal `S001_1`).

> [!NOTE]
> Jika `BOT001` dengan nama `"Architect"` berganti nama menjadi `"Lead Architect"`, seluruh riwayat pesan terdahulu tetap valid dan utuh karena pesan internal diikat ke `BOT001`. Pengirim baru pun dapat menyapa menggunakan nama baru `"Lead Architect"`.

---

## 4. Model Komunikasi: Broadcast vs Direct Message

### A. Broadcast Event Log (`events.jsonl`)
- Bersifat **Append-Only** (hanya menambah di baris akhir file).
- Cocok untuk pengumuman publik, pembaruan status arsitektur, keputusan bersama (*decision*), atau tugas baru (*task assigned*).
- Setiap bot memiliki catatan **Read Cursor** tersendiri di `inbox/<bot_id>/cursors.json`. Ketika bot membaca broadcast, posisi baca otomatis bergerak maju sehingga bot tidak membaca ulang pengumuman yang sama.

### B. Direct Messaging & Individual Blackboard (`inbox/<bot_id>/`)
- Bersifat **Point-to-Point**.
- Pesan langsung ditujukan kepada bot spesifik (bisa via Bot ID atau Display Name).
- Memiliki status siklus hidup: `unread` ➔ `read` ➔ `acknowledged`.
- Pengakuan (*acknowledgement*) bersifat **Idempotent**: pemanggilan berkali-kali tidak akan merusak data status.

---

## 5. Ketahanan Sistem & Penanganan Kegagalan (Fault Tolerance)

### A. Deteksi Bot Mati (Stale Detection)
Jika sebuah proses bot dimatikan secara paksa (misal `kill -9` atau terminal ditutup paksa):
1. Sistem operasi akan menghapus PID proses tersebut.
2. Saat bot lain atau operator menjalankan perintah `almudaya bot list`, sistem memeriksa `last_seen_at` dan keaktifan PID (`process.kill(pid, 0)`).
3. Bot yang PID-nya mati otomatis diperbarui statusnya menjadi `stale`.
4. Bot tersebut dapat dinyalakan kembali menggunakan `almudaya bot run` dengan ID yang sama tanpa kehilangan data.

### B. Penguncian File Aman (Cross-Process File Locking)
Untuk mencegah kerusakan saat beberapa proses bot menulis ke Blackboard pada mikrodetik yang sama:
- Sistem menggunakan *kernel-atomic file locking* via `fs.open(lockFilePath, 'wx')`.
- Pada sistem operasi Windows, sistem secara cerdas menangani perebutan handle (`EEXIST`, `EPERM`, `EBUSY`, `EACCES`) dengan *jitter* acak dan *bounded backoff*.
- Jika sebuah bot crash saat sedang memegang lock, sistem mendeteksi kematian PID bot tersebut dan otomatis membuka (*break*) *stale lock* tersebut.

---

## 6. Keamanan & Sanitasi Kredensial (Secret Redaction)

Saat agen bekerja sama, sering kali variabel lingkungan atau token API dibagikan dalam konteks proyek. Untuk mencegah kebocoran kredensial ke file Blackboard publik atau log:
- Modul [`src/shared/service.ts`](file:///d:/almudaya_multiagent_v0.1.0/src/shared/service.ts) secara otomatis memindai pasangan *key-value*.
- Kunci yang mengandung pola sensitif (seperti `TOKEN`, `KEY`, `SECRET`, `PASSWORD`, `AUTH`, `PRIVATE`) atau nilai string yang cocok dengan format token ber-entropi tinggi (misal token GitHub `ghp_*`, AWS key, private key) langsung diubah menjadi:
  `[REDACTED]`

---

## 7. Rencana Pengembangan Antarmuka (GUI Roadmap)

Meskipun versi v0.1.0 berfokus 100% pada CLI dan fondasi storage, arsitektur v0.1.0 sudah siap untuk antarmuka grafis di rilis mendatang:

1. **Web Dashboard Lokal (Rencana v0.2.0):**
   - Server web lokal ringan berbasis Vite/React.
   - Visualisasi graf interaksi bot, timeline broadcast live, dan visual inbox.
2. **Terminal UI (TUI):**
   - Dashboard terminal interaktif (*split screen*) berbasis `ink`.
3. **Integrasi AI Agent (LLM Engine):**
   - Menghubungkan bot dengan model AI (Gemini, Claude, OpenAI) melalui adaptor antarmuka yang membaca inbox Blackboard dan memproduksi aksi kode.
