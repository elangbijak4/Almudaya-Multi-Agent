# Software Requirements Specification (SRS) — Almudaya Multi-Agent v0.2.0

**Document Version:** 0.2.0  
**Status:** DRAFT (Approved for Requirements Baseline)  
**Date:** 2026-11-02  

---

## 1. Tujuan & Ruang Lingkup

Dokumen ini mendefinisikan kebutuhan perangkat lunak untuk **Almudaya Multi-Agent Versi 0.2.0**, yang memperluas fondasi infrastruktur v0.1.0 dengan kemampuan penalaran cerdas (*AI Reasoning*), manipulasi berkas kode pada target project roots, eksekusi perintah sistem, dan mode keamanan operasional (*Request Review* vs *Turbo*).

---

## 2. Kebutuhan Fungsional (Functional Requirements)

### 2.1 Lapisan Abstraksi AI Provider & Integrasi Model

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-201** | Sistem menyediakan antarmuka abstrak `IAIModelProvider` yang mendefinisikan kontrak komunikasi standar (generasi teks, penalaran pesan, dan eksekusi tool/function calling) independen dari vendor AI. | Must |
| **FR-202** | Sistem menyediakan adapter resmi untuk **Google Gemini** yang mendukung model modern (misal `gemini-2.5-flash` dan `gemini-2.5-pro`) menggunakan SDK `@google/genai` resmi. | Must |
| **FR-203** | Setiap bot dalam session yang sama dapat dikonfigurasikan dengan provider dan nama model yang berbeda secara independen. | Must |
| **FR-204** | API Key dan kredensial AI diselesaikan dari variabel lingkungan lokal proses bot (misal `GEMINI_API_KEY`) dan **dilarang keras disimpan mentah di dalam file Session Blackboard**. | Must |
| **FR-205** | Sistem secara otomatis menginjeksi konteks dinamis Session (nama bot, peran, daftar peer bot yang aktif, dan direktori project roots yang terdaftar) ke dalam System Prompt AI. | Must |

---

### 2.2 Perkakas Manipulasi Berkas Target (Target Codebase File Tools)

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-206** | Sistem menyediakan tool `read_file` untuk membaca konten file pada direktori target project root. | Must |
| **FR-207** | Sistem menyediakan tool `write_file` untuk membuat atau mengganti seluruh konten file pada target project root. | Must |
| **FR-208** | Sistem menyediakan tool `edit_file` untuk melakukan penggantian potongan teks secara presisi (*exact search-and-replace*) pada file target. | Must |
| **FR-209** | Sistem menyediakan tool `list_dir` dan `search_files` untuk memungkinkan bot mengeksplorasi struktur pohon folder dan mencari file berdasarkan pola/kata kunci. | Must |
| **FR-210** | **Path Traversal Sandboxing:** Sistem memvalidasi seluruh path file yang diminta bot; setiap upaya pembacaan atau penulisan di luar direktori `project roots` yang sah wajib ditolak keras (*security exception*). | Must |

---

### 2.3 Eksekusi Perintah Sistem (System Command Execution)

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-211** | Sistem menyediakan tool `run_command` untuk menjalankan perintah sistem/shell (misal: `npm test`, `git status`, `python main.py`) di dalam project root target. | Must |
| **FR-212** | Tool `run_command` menangkap `stdout`, `stderr`, dan kode exit, serta memiliki batas waktu (*execution timeout*) untuk mencegah proses menggantung (*infinite wait*). | Must |

---

### 2.4 Mode Eksekusi Keamanan: Request Review vs Turbo

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-213** | **Mode `REQUEST_REVIEW` (Human-in-the-Loop):** Setiap kali bot memutuskan untuk memanggil tool yang memiliki efek samping (*mutasi berkas* atau *eksekusi perintah sistem*), sistem menahan eksekusi dan meminta konfirmasi persetujuan (Y/N/Diff) dari operator manusia di terminal sebelum dijalankan. | Must |
| **FR-214** | **Mode `TURBO` (Autonomous Mode):** Bot mengeksekusi tool koding dan perintah sistem yang diizinkan secara mandiri dan langsung tanpa meminta konfirmasi per langkah, guna kecepatan kolaborasi otonom. | Must |
| **FR-215** | Mode eksekusi dapat dikonfigurasi saat memulai bot via CLI (misal `--mode review` atau `--mode turbo`). | Must |

---

### 2.5 Kolaborasi Otonom Antar-Bot & Audit Trail

| ID | Kebutuhan | Prioritas |
|---|---|:---:|
| **FR-216** | **Autonomous Collaboration Loop:** Ketika sebuah bot menerima direct message dari bot lain atau broadcast di inbox-nya, bot runtime secara otomatis meneruskannya ke model AI untuk inferensi, mengeksekusi tool yang diperlukan, dan otomatis mengirim balasan ke inbox pengirim. | Must |
| **FR-217** | **Audit Trail Logging:** Setiap pemanggilan tool, diff file yang diubah, perintah shell yang dijalankan, dan ringkasan pemikiran AI dicatat ke log event broadcast Session Blackboard sebagai transparansi kolaborasi. | Must |
| **FR-218** | CLI `almudaya bot run` diperluas dengan parameter AI: `--provider <name>`, `--model <model>`, dan `--mode <review|turbo>`. | Must |

---

## 3. Kebutuhan Non-Fungsional (Non-Functional Requirements)

| ID | Kebutuhan |
|---|---|
| **NFR-201** | Seluruh implementasi provider, tools, dan loop agen menggunakan TypeScript *strict mode*. |
| **NFR-202** | Pengujian unit dan integrasi wajib menyediakan **Mock AI Provider** agar test suite dapat berjalan 100% offline tanpa mengonsumsi kuota API berbayar. |
| **NFR-203** | Penanganan kegagalan jaringan API LLM (rate limit, timeout) harus memiliki mekanisme retry cerdas atau pelaporan error yang jelas tanpa merusak status bot di Blackboard. |
| **NFR-204** | Kecepatan respons tool file harus efisien dan tidak membaca file biner raksasa ke memori secara sembarangan. |
| **NFR-205** | Kompatibilitas penuh di Windows 10/11, macOS, dan Linux. |

---

## 4. Aturan Keamanan & Invariant Tambahan (v0.2.0)

1. **Invariant 5 (Sandbox Boundary):** Operasi berkas AI dibatasi 100% pada direktori yang terdaftar di `almudaya context root`. Upaya akses `..` di luar root wajib dilempar sebagai `PathSecurityError`.
2. **Invariant 6 (Review Sovereignty):** Pada mode `REQUEST_REVIEW`, tidak ada satu baris kode pun yang ditulis ke disk tanpa persetujuan eksplisit operator.
3. **Invariant 7 (Credential Privacy):** Variabel API key hanya hidup di memori proses bot lokal; dilarang mencatat nilai API key ke Blackboard, log event, atau file JSON mana pun.
