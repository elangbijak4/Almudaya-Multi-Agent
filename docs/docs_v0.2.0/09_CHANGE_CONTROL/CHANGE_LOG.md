# Change Log — Almudaya Multi-Agent v0.2.0

Catatan kontrol perubahan arsitektur, ruang lingkup, dan kebutuhan untuk versi 0.2.0.

| Change ID | Tanggal | Deskripsi | Alasan | Dampak | Keputusan |
|---|---|---|---|---|---|
| **CHG-201** | 2026-11-02 | Inisiasi Baseline v0.2.0 | Menambahkan lapisan AI Multi-Provider, coding tools pada project root, eksekusi shell, dan mode keamanan (Request Review vs Turbo) | Pengembangan kapabilitas AI dan otonomi koding agen | Disetujui (Approved) |
| **CHG-202** | 2026-11-02 | Menyelesaikan Phase 2 System Analysis & Architecture Design | Menyusun SYSTEM_ANALYSIS, DATA_FLOWS, SYSTEM_DESIGN, merumuskan ADR-201 s/d ADR-204, dan memecahkan OI-201 s/d OI-203 | Fondasi desain arsitektur AI, sandboxing, perkakas berkas/shell, dan mode keamanan | Passed Phase 2 Gate |
| **CHG-203** | 2026-11-02 | Menyelesaikan Phase 3 AI Provider Layer & Google Gemini Adapter | Memasang `@google/genai`, mengimplementasikan `IAIModelProvider`, `GeminiProvider`, `MockAIProvider`, `credentials`, `prompts`, 15 unit tests baru (total 93 tests lulus) | Lapisan penalaran AI aktif, mendukung function calling dan resolusi API key aman | Passed Phase 3 Gate |
| **CHG-204** | 2026-11-02 | Menyelesaikan Phase 4 Project Root File Tools & Path Sandboxing | Mengimplementasikan `sandbox.ts` (Invariant 5, anti-traversal), `file-tools.ts` (`read_file`, `write_file`, `edit_file`, `list_dir`, `search_files`), dispatcher, 26 unit tests baru (total 119 tests lulus) | Bot AI memiliki kapabilitas koding sistem berkas nyata dengan proteksi sandbox ketat | Passed Phase 4 Gate |
| **CHG-205** | 2026-11-02 | Menyelesaikan Phase 5 Command Execution Engine & Safety Modes | Mengimplementasikan `command-tools.ts` (`run_command` dengan tree-kill timeout), `execution-mode.ts` (`REQUEST_REVIEW` vs `TURBO`, Invariant 6 sovereignty), 13 unit tests baru (total 132 tests lulus) | Bot AI dapat mengeksekusi shell perintah build/test dengan kedaulatan konfirmasi operator | Passed Phase 5 Gate |
