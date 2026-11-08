# Architecture Decision Records — v0.3.2

Status: `Proposed`, `Accepted`, `Superseded`, atau `Rejected`.

## ADR-001 — Agent Capability Governance (ACG)
- Status: Accepted
- Keputusan: capability grant eksplisit, scoped, terikat bot/session, expiry, grantor, approval mode, status, audit.
- Default deny; revoke/expiry efektif; TURBO tidak menaikkan privilege.

## ADR-002 — Execution Controller
- Status: Accepted
- Semua sensitive execution melewati policy enforcement boundary; tidak ada direct shell bypass.

## ADR-003 — OS-level isolation
- Status: Accepted sebagai requirement; adapter platform harus diverifikasi.
- Path/prompt/regex checks bukan pengganti isolasi OS; fail closed jika isolator wajib gagal/tidak tersedia.

## ADR-004 — Delivery semantics
- Status: Accepted
- Inbox at-least-once dengan idempotency dan acknowledgment; bukan exactly-once tanpa transaksi atomik end-to-end.

## ADR-005 — Security audit trail
- Status: Accepted
- Security events dipisahkan dari work log biasa; redaction terpusat.

## ADR-006 — Compatibility and migration
- Status: Proposed
- Putuskan migrasi konfigurasi/Blackboard v0.3.1, perlakuan grant lama, dan rollback.

## ADR template
### ADR-XXX — [Judul]
- Status:
- Context:
- Decision:
- Alternatives:
- Consequences/security implications:
- Migration:
- Related findings/requirements:
- Tests/evidence:
