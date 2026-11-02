# ADR-201: AI Multi-Provider Interface and Google Gemini Adapter

- **Status:** APPROVED
- **Date:** 2026-11-02
- **Deciders:** Product Owner, Lead Architect
- **Consulted:** SRS v0.2.0 (FR-201, FR-202, FR-203, FR-204, NFR-202)
- **Resolves:** `OI-201`

---

## 1. Konteks & Masalah

Almudaya v0.2.0 membutuhkan kemampuan penalaran AI pada bot runtime. Sistem tidak boleh terkunci (*vendor lock-in*) pada satu penyedia AI saja, melainkan harus mendukung multi-provider (Gemini, Claude, OpenAI, Ollama) di mana setiap bot dapat memilih provider berbeda. Di samping itu, untuk pengujian unit otomatis, sistem wajib dapat berjalan tanpa kredensial atau kuota internet (*offline mock provider*).

Isu terbuka `OI-201` mempertanyakan SDK mana yang harus digunakan untuk adapter Google Gemini awal.

---

## 2. Keputusan yang Diambil

1. **Abstraksi Multi-Provider (`IAIModelProvider`):**
   Mendefinisikan antarmuka murni di `src/ai/provider.ts`:
   ```typescript
   export interface ToolDefinition {
     name: string;
     description: string;
     parameters: Record<string, unknown>; // JSON Schema
   }

   export interface ToolCallRequest {
     id: string;
     name: string;
     arguments: Record<string, unknown>;
   }

   export interface AIRequest {
     systemPrompt: string;
     messages: Array<{ role: 'user' | 'model' | 'tool'; content: string; toolResult?: unknown }>;
     tools?: ToolDefinition[];
     temperature?: number;
     maxTokens?: number;
   }

   export interface AIResponse {
     text?: string;
     toolCalls?: ToolCallRequest[];
     usage?: { promptTokens: number; candidateTokens: number };
   }

   export interface IAIModelProvider {
     readonly providerId: string;
     readonly modelName: string;
     generateResponse(request: AIRequest): Promise<AIResponse>;
   }
   ```

2. **Pemilihan SDK Google Gemini (Resolusi `OI-201`):**
   Dipilih SDK resmi generasi terbaru: **`@google/genai`**.
   - *Alasan:* SDK ini dirancang khusus untuk Gemini 2.5 Flash / Pro, mendukung Function Calling terstruktur secara native, dan memiliki kinerja serialisasi yang lebih bersih dibanding legacy `@google/generative-ai`.

3. **Penyelesaian Kredensial (API Key Resolution):**
   - API Key diselesaikan saat bot dijalankan melalui `process.env['GEMINI_API_KEY']` (atau flag opsional `--api-key-env <NAME>`).
   - Nilai API Key hanya disimpan dalam memori RAM proses bot lokal dan **tidak pernah ditulis ke disk Blackboard** (mematuhi Invariant 7 dan NFR-007).

4. **Mock Provider untuk Pengujian (`MockAIProvider`):**
   - Disediakan implementasi mock deterministik di `src/ai/mock-provider.ts` dan `tests/mocks/` yang dapat dikonfigurasi untuk mengembalikan respons teks atau tool call yang terprogram, memungkinkan 100% tes otomatis berjalan tanpa biaya dan tanpa jaringan internet.

---

## 3. Konsekuensi

- **Positif:**
  - Kode domain bot runtime sepenuhnya terisolasi dari detail SDK vendor tertentu.
  - Membuka jalan integrasi penyedia lain (OpenAI, Anthropic, Ollama) di masa depan cukup dengan menambahkan satu file adapter baru.
  - Keamanan kredensial terjamin mutlak.
- **Negatif / Mitigasi:**
  - Menambah dependensi `@google/genai`. Mitigasi: SDK ini adalah satu-satunya dependensi AI resmi, dan mock provider digunakan untuk seluruh test suite lokal.
