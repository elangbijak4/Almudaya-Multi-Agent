# Open Issues — Almudaya Multi-Agent v0.2.0

Melacak isu terbuka dan keputusan teknis yang perlu dimatangkan sebelum fase implementasi kode v0.2.0.

| Issue ID | Pertanyaan | Dampak | Keputusan & Rujukan ADR | Status |
|---|---|---|---|:---:|
| **OI-201** | SDK Google Gemini mana yang akan digunakan? | Dependensi runtime & kompatibilitas model terbaru | **Dipilih Opsi A:** Menggunakan SDK modern `@google/genai` resmi untuk Gemini 2.5 Pro/Flash. | **Resolved** (ADR-201) |
| **OI-202** | Bagaimana interaksi prompt persetujuan di CLI untuk mode `REQUEST_REVIEW`? | Pengalaman pengguna & kelancaran terminal | Menggunakan `node:readline/promises` bawaan Node.js tanpa dependensi tambahan; menampilkan pratinjau diff dan prompt `[y/n/d]`. | **Resolved** (ADR-203) |
| **OI-203** | Di mana log audit pemanggilan tool AI dicatat di Blackboard? | Struktur penyimpanan data Blackboard | **Dipilih Opsi A:** Dicatat sebagai event kategori `ACTIVITY` / `DECISION` di `events.jsonl` agar peer bot lain bisa mengamati secara transparan. | **Resolved** (ADR-204) |
