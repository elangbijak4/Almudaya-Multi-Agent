# Use Cases

## UC-01 — Create Session

**Actor:** Human operator  
**Precondition:** CLI tersedia.  
**Main flow:** Operator menjalankan perintah create; sistem memvalidasi nama/ID; membuat workspace Session; menyimpan metadata; menampilkan Session ID dan lokasi data.  
**Alternative:** ID bentrok atau direktori tidak dapat ditulis; sistem menampilkan error dan tidak meninggalkan state parsial.  
**Postcondition:** Session persisten tersedia.

## UC-02 — Join Session with a Bot

**Actor:** Bot process / human operator  
**Precondition:** Session tersedia.  
**Main flow:** Bot dimulai dengan Session ID dan Bot ID; sistem memvalidasi Session; mendaftarkan identitas dan display name; status bot diperbarui; bot menerima ringkasan konteks bersama.  
**Postcondition:** Bot muncul dalam registry.

## UC-03 — Discover Peers

**Actor:** Bot  
**Precondition:** Bot terdaftar dalam Session.  
**Main flow:** Bot meminta daftar anggota Session; sistem mengembalikan Bot ID, display name, description, dan status.  
**Postcondition:** Bot memiliki snapshot peer registry.

## UC-04 — Broadcast Event

**Actor:** Bot  
**Precondition:** Bot terdaftar.  
**Main flow:** Bot membuat event; sistem memvalidasi payload; event diberi ID/timestamp; event disimpan di broadcast log.  
**Postcondition:** Event dapat dibaca oleh anggota Session.

## UC-05 — Send Direct Message

**Actor:** Bot  
**Precondition:** Pengirim dan penerima terdaftar dalam Session.  
**Main flow:** Pengirim menyebut target Bot ID atau display name; sistem menyelesaikan display name ke Bot ID; pesan divalidasi dan ditulis ke inbox penerima.  
**Alternative:** Target ambigu/tidak ditemukan atau inbox tidak dapat ditulis; pesan ditolak dengan error yang jelas.  
**Postcondition:** Pesan persisten di inbox penerima.

## UC-06 — Read and Acknowledge Message

**Actor:** Bot  
**Precondition:** Inbox tersedia.  
**Main flow:** Bot membaca pesan; sistem mengembalikan status; bot meng-acknowledge pesan; status acknowledgement tersimpan.  
**Postcondition:** Pesan memiliki status baca/ack yang konsisten.

## UC-07 — Rename Bot

**Actor:** Human operator / authorized bot operation  
**Precondition:** Bot terdaftar.  
**Main flow:** Nama baru divalidasi; uniqueness diperiksa; registry diperbarui; Bot ID tidak berubah.  
**Postcondition:** Peer discovery menggunakan nama baru; historical messages tetap merujuk Bot ID.

## UC-08 — Register Shared Project Context

**Actor:** Human operator  
**Precondition:** Session tersedia.  
**Main flow:** Operator mendaftarkan project root, environment metadata, atau dokumen SDLC; sistem memvalidasi record dan menyimpannya.  
**Postcondition:** Semua bot dapat membaca referensi konteks bersama.
