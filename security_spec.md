# SyncWatch Security Specification

## 1. Data Invariants

1. **User Profile Ownership & PII Isolation**: A `/users/{userId}` document contains zero PII (no email, phone, or address) and is readable/writable strictly by the authenticated owner (`request.auth.uid == userId`).
2. **Authoritative Room Admin**: Only the authenticated creator (`adminId == request.auth.uid`) may modify video source, playback state, room settings, or end a room. Viewers cannot modify room documents under any circumstance.
3. **Terminal Room State Locking**: Once a room transitions to `status == 'ended'`, no further updates are permitted by standard users.
4. **Master Gate Subcollection Integrity**: Participants (`/rooms/{roomId}/participants/{participantId}`) and messages (`/rooms/{roomId}/messages/{messageId}`) require an existing parent room and active membership verified against the parent room document.
5. **Role Escalation Prevention**: A participant cannot self-assign `role: 'admin'` unless `parentRoom.adminId == request.auth.uid`, and `role` is immutable after join.
6. **Temporal Integrity & Field Immutability**: `createdAt`, `joinedAt`, `adminId`, `roomCode`, and `userId` are immutable after creation and validated against `request.time`.
7. **Chat Gate Enforcement**: Messages cannot be created if the parent room has `status == 'ended'` or `chatEnabled == false`, or if the sender is not a verified participant/admin.

## 2. The Dirty Dozen Payloads (All Must Return PERMISSION_DENIED)

1. **P1 — Shadow Field Injection on User Create**: `{ "userId": "u1", "displayName": "Alex", "avatar": "cosmic", "createdAt": "SERVER_TIME", "updatedAt": "SERVER_TIME", "isAdmin": true }`
2. **P2 — Cross-User Profile Read (PII/Ownership Leak)**: User `u2` attempting `get` on `/users/u1`.
3. **P3 — Identity Spoofing on Room Create**: User `u2` creating `/rooms/SW-ABCDE` with `adminId: "u1"`.
4. **P4 — Viewer Playback Hijack**: Viewer `u2` updating `playbackPlaying: false` on `/rooms/SW-ABCDE`.
5. **P5 — Viewer Role Self-Escalation**: Viewer `u2` creating `/rooms/SW-ABCDE/participants/u2` with `role: "admin"`.
6. **P6 — Post-Terminal Room Mutation**: Admin `u1` updating `playbackPosition: 42` on a room where `status == "ended"`.
7. **P7 — Locked Room Unauthorized Join**: User `u3` creating participant doc on room with `isLocked == true`.
8. **P8 — Disabled Chat Bypass**: Participant `u2` creating a message in a room with `chatEnabled == false`.
9. **P9 — Non-Member Message Injection**: Outsider `u9` creating a message in `/rooms/SW-ABCDE/messages/m1`.
10. **P10 — Resource Poisoning (Oversized ID / Text)**: Creating a message with 2KB text or invalid ID containing `../`.
11. **P11 — Client-Forged Timestamp**: Creating a room or message with a client-supplied past timestamp instead of `request.time`.
12. **P12 — Unverified Email Spoof**: Request with admin email in token but `email_verified: false`.
