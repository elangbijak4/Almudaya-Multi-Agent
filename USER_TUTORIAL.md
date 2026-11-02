# Almudaya Multi-Agent — Hands-on Step-by-Step Tutorial

Tutorial praktis langkah demi langkah untuk mencoba langsung ekosistem multi-agent Almudaya Multi-Agent (`almudaya-multiagent` v0.1.0) di komputer lokal Anda.

---

## Skenario Tutorial

Kita akan mensimulasikan lingkungan kolaborasi pengembangan software nyata dengan:
1. **Dua Bot Independen:**
   - `BOT001` dengan nama tampilan `"Architect"` (Arsitek Sistem) di Terminal 1.
   - `BOT002` dengan nama tampilan `"Coder"` (Software Engineer) di Terminal 2.
2. **Satu Operator Manusia:**
   - Mengendalikan session, mengamati Blackboard, dan mengirim instruksi di Terminal 3.
3. **Satu Proyek Target Nyata:**
   - Proyek target berada di folder tersendiri di luar engine Almudaya.

---

## Langkah 1: Build & Daftarkan CLI Global

Buka PowerShell di folder engine Almudaya (`d:\almudaya_multiagent_v0.1.0`):

```powershell
# 1. Pastikan kompilasi TypeScript selesai
npm run build

# 2. Daftarkan CLI ke sistem Windows secara global
npm link

# 3. Pastikan CLI aktif dan siap
almudaya --version
```
Jika muncul `0.1.0`, maka perintah `almudaya` kini siap dipanggil dari **folder mana saja di terminal Anda**.

---

## Langkah 2: Siapkan Folder Proyek Target di Luar Engine

Mari kita buat folder proyek contoh yang terpisah dari folder engine Almudaya (misalnya di drive `D:\TutorialApp`):

```powershell
# Buat folder proyek target di luar Almudaya
mkdir D:\TutorialApp
cd D:\TutorialApp

# Buat berkas README sederhana di proyek target
Set-Content -Path README.md -Value "# Tutorial App Project"
```

---

## Langkah 3: Buat Session Baru (Terminal 1 - Operator)

Tetap berada di `D:\TutorialApp` (atau folder mana pun yang Anda sukai), buat Session baru bernama `tutorial-session` dengan ID `S001`:

```powershell
almudaya session create "Tutorial Project" --session S001 --description "Kolaborasi Perdana Architect dan Coder"
```

Output yang dihasilkan:
```text
Session "Tutorial Project" (ID: S001) successfully created.
Status: active
Workspace: C:\Users\<User>\AppData\Local\almudaya\sessions\S001
```

Sekarang hubungkan proyek target `D:\TutorialApp` ke dalam konteks Session `S001`:
```powershell
almudaya context root add --session S001 --name core-app --path D:\TutorialApp --type primary
```

---

## Langkah 4: Jalankan Bot 1 ("Architect") di Terminal Baru

Buka **jendela terminal baru (Terminal 2)**:

```powershell
# 1. Daftarkan bot ke Session S001
almudaya bot join --session S001 --bot BOT001 --display-name "Architect" --role "System Architect"

# 2. Jalankan runtime daemon bot Architect
almudaya bot run --session S001 --bot BOT001 --interval 2000
```

Terminal 2 sekarang akan menampilkan status aktif:
```text
Bot "Architect" (ID: BOT001) runtime started in session S001.
Operating System PID: 14208
Heartbeat interval: 2000ms
Auto-acknowledge inbox: enabled
Listening for incoming direct messages and maintaining heartbeat...
(Press Ctrl+C to stop)
```

---

## Langkah 5: Jalankan Bot 2 ("Coder") di Terminal Baru

Buka **jendela terminal ketiga (Terminal 3)**:

```powershell
# 1. Daftarkan bot Coder ke Session S001
almudaya bot join --session S001 --bot BOT002 --display-name "Coder" --role "Software Engineer"

# 2. Jalankan runtime daemon bot Coder
almudaya bot run --session S001 --bot BOT002 --interval 2000
```

Terminal 3 kini berjalan sebagai proses bot mandiri dengan PID berbeda dari Terminal 2!

---

## Langkah 6: Buktikan Peer Discovery (Terminal 1)

Kembali ke **Terminal 1 (Operator)**. Mari kita lihat apakah kedua bot saling mengenali:

```powershell
almudaya bot list --session S001
```

Output:
```text
Registered bots in session S001 (2):
- BOT001 | Architect (System Architect) [active] (PID: 14208)
- BOT002 | Coder (Software Engineer) [active] (PID: 18452)
```
Kedua bot terdaftar dan aktif secara simultan di proses sistem operasi yang berbeda!

---

## Langkah 7: Publikasi Broadcast Arsitektur

Sebagai bot `"Architect"`, publikasikan keputusan arsitektur ke seluruh Session:

```powershell
almudaya broadcast publish --session S001 --bot BOT001 --category DECISION --payload '{"architecture":"Clean Architecture","database":"PostgreSQL"}'
```

Sekarang baca broadcast tersebut sebagai bot `"Coder"`:
```powershell
almudaya broadcast read --session S001 --bot BOT002
```

Output:
```text
Broadcast events for bot BOT002 (1):
- [DECISION] Event evt_... from BOT001: {"architecture":"Clean Architecture","database":"PostgreSQL"}
Cursor advanced to: evt_...
```
*(Posisi baca bot `BOT002` otomatis diperbarui, sehingga pemanggilan berikutnya tidak akan membaca ulang event yang sama).*

---

## Langkah 8: Kirim Pesan Langsung (Direct Message) & Acknowledgement

Kirim pesan langsung dari `"Coder"` ke `"Architect"`. Anda bisa menyapa langsung menggunakan **display name** (`"Architect"`):

```powershell
almudaya message send --session S001 --sender BOT002 --recipient "Architect" --body "Arsitektur Clean Architecture telah saya pelajari. Saya mulai implementasi modul user."
```

Sekarang periksa inbox milik `"Architect"`:
```powershell
almudaya message read --session S001 --bot BOT001
```

Output:
```text
Direct messages in inbox of BOT001 (1):
- Message msg_... from BOT002 [unread]: "Arsitektur Clean Architecture telah saya pelajari. Saya mulai implementasi modul user."
```

Konfirmasikan penerimaan pesan (*acknowledgement*):
```powershell
almudaya message ack --session S001 --bot BOT001 --message-id <masukkan_id_pesan_di_atas>
```

---

## Langkah 9: Mengubah Nama Bot (Rename) & Integritas Pesan

Ubah nama bot `BOT001` menjadi `"Lead Architect"`:
```powershell
almudaya bot rename --session S001 --bot BOT001 --new-name "Lead Architect"
```

Verifikasi daftar bot:
```powershell
almudaya bot list --session S001
```
*(Nama bot telah berubah menjadi `Lead Architect`, namun `BOT001` tetap sama dan seluruh inbox pesan historis tetap terjaga utuh!)*

---

## Langkah 10: Simulasi Crash Recovery & Persistensi

1. Buka Terminal 2 tempat bot `BOT001` berjalan, lalu tekan **Ctrl + C** untuk mematikannya.
2. Di Terminal 1 (Operator), cek status bot:
   ```powershell
   almudaya bot list --session S001
   ```
   *(Status `BOT001` akan terdeteksi sebagai `stopped` atau `stale`)*.
3. Jalankan kembali bot tersebut:
   ```powershell
   almudaya bot run --session S001 --bot BOT001
   ```
4. Baca kembali riwayat pesan di `BOT001`:
   ```powershell
   almudaya message read --session S001 --bot BOT001 --status all
   ```
   Seluruh riwayat pesan, session, dan konteks tetap tersimpan rapi dan tidak ada data yang hilang!

---

## Selamat! 🎉
Anda telah berhasil mempraktikkan kolaborasi multi-agent independen dengan Almudaya Multi-Agent.
