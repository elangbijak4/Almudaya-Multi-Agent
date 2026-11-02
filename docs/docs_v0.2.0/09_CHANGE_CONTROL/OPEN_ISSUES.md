# Open Issues — Almudaya Multi-Agent v0.2.0

Melacak isu terbuka dan keputusan teknis yang perlu dimatangkan sebelum fase implementasi kode v0.2.0.

| Issue ID | Pertanyaan | Dampak | Opsi Solusi | Status |
|---|---|---|---|:---:|
| **OI-201** | SDK Google Gemini mana yang akan digunakan? | Dependensi runtime & kompatibilitas model terbaru | **Opsi A (Direkomendasikan):** Menggunakan `@google/genai` (SDK generasi terbaru dari Google yang mendukung Gemini 2.5 Flash/Pro dan Live API).<br>**Opsi B:** Menggunakan legacy `@google/generative-ai`. | Open (Pilihan A direkomendasikan) |
| **OI-202** | Bagaimana interaksi prompt persetujuan di CLI untuk mode `REQUEST_REVIEW`? | Pengalaman pengguna & kelancaran terminal | Menggunakan `node:readline/promises` bawaan Node.js tanpa menambah dependensi pihak ketiga yang berat. Menampilkan diff ringkas dan prompt `[y/n/d]`. | Open |
| **OI-203** | Di mana log audit pemanggilan tool AI dicatat di Blackboard? | Struktur penyimpanan data Blackboard | **Opsi A (Direkomendasikan):** Dicatat sebagai event kategori `ACTIVITY` / `ARTIFACT` di `events.jsonl` agar rekan bot lain juga bisa mengamati riwayat tool secara terdesentralisasi.<br>**Opsi B:** Dibuatkan folder baru `audit/`. | Open |
