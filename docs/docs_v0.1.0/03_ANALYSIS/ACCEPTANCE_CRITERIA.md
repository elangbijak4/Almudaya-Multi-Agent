# Acceptance Criteria

## A. Scaffold

- [ ] Environment inspection report exists.
- [ ] Node.js baseline is verified.
- [ ] npm project metadata is valid.
- [ ] TypeScript strict build passes.
- [ ] CLI help and version work.
- [ ] At least one automated test passes.
- [ ] Package dry-run succeeds.

## B. Session and Blackboard

- [ ] Session can be created and reopened.
- [ ] Session metadata survives restart.
- [ ] Workspace path is configurable/documented.
- [ ] Invalid or corrupted metadata is detected with a useful error.

## C. Bot identity and discovery

- [ ] Two independent processes join the same Session.
- [ ] Each bot has a stable Bot ID.
- [ ] Each bot has a display name and description.
- [ ] Default name generation is deterministic and documented.
- [ ] User-specified name is supported.
- [ ] Duplicate names are handled according to the approved policy.
- [ ] Rename preserves Bot ID and historical references.
- [ ] Peer discovery returns both bots.

## D. Messaging

- [ ] Broadcast event is persisted and readable by peers.
- [ ] Direct message reaches the correct inbox.
- [ ] Unknown recipient is rejected.
- [ ] Message ID and timestamp are present.
- [ ] Read/acknowledgement state persists.
- [ ] Concurrent operations do not corrupt records or silently lose messages.

## E. Shared context

- [ ] Multiple project roots can be registered and listed.
- [ ] Environment metadata can be registered and read.
- [ ] SDLC document references can be registered and read.
- [ ] Secret values are excluded or redacted.

## F. End-to-end proof

Complete the two-terminal scenario in `MASTER_PROMPT.md`, including shutdown and restart persistence.

## G. Release

- [ ] README and changelog are accurate.
- [ ] Known limitations are documented.
- [ ] Requirement traceability is complete.
- [ ] Full test suite passes.
- [ ] npm package contents are reviewed.
- [ ] No publish/push occurs without explicit authorization.
