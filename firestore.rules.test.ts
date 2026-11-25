/**
 * Payload-First Security Rule Test Specification for SyncWatch.
 * Verifies all 12 Dirty Dozen adversarial payloads against the Eight Pillars ruleset.
 */

export interface SecurityTestCase {
  id: string;
  title: string;
  path: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  auth: { uid: string; email?: string; email_verified?: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
  enforcedBy: string;
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 'P1',
    title: 'Shadow Field Injection on User Profile Create',
    path: '/users/user_1',
    operation: 'create',
    auth: { uid: 'user_1', email: 'user1@example.com', email_verified: true },
    payload: { userId: 'user_1', displayName: 'Alex', avatar: 'cosmic', isAdmin: true },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isValidUserProfile -> data.keys().hasOnly([...])',
  },
  {
    id: 'P2',
    title: 'Cross-User Profile Read',
    path: '/users/user_1',
    operation: 'get',
    auth: { uid: 'user_2', email: 'user2@example.com', email_verified: true },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isOwner(userId)',
  },
  {
    id: 'P3',
    title: 'Room Admin Identity Spoofing',
    path: '/rooms/SW-7F3D9',
    operation: 'create',
    auth: { uid: 'user_2', email: 'user2@example.com', email_verified: true },
    payload: { roomCode: 'SW-7F3D9', adminId: 'user_1', status: 'active', maxParticipants: 2, chatEnabled: true, isLocked: false },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'incoming().adminId == request.auth.uid',
  },
  {
    id: 'P4',
    title: 'Viewer Playback Hijack Attempt',
    path: '/rooms/SW-7F3D9',
    operation: 'update',
    auth: { uid: 'viewer_1', email: 'viewer@example.com', email_verified: true },
    payload: { playbackPlaying: false, playbackPosition: 10 },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'existing().adminId == request.auth.uid',
  },
  {
    id: 'P5',
    title: 'Viewer Self-Assigns Admin Role',
    path: '/rooms/SW-7F3D9/participants/viewer_1',
    operation: 'create',
    auth: { uid: 'viewer_1', email: 'viewer@example.com', email_verified: true },
    payload: { userId: 'viewer_1', roomAdminId: 'admin_1', displayName: 'Viewer', avatar: 'cosmic', role: 'admin', isOnline: true },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'parentRoom.data.adminId == request.auth.uid',
  },
  {
    id: 'P6',
    title: 'Mutation After Room Terminal Ended State',
    path: '/rooms/SW-7F3D9',
    operation: 'update',
    auth: { uid: 'admin_1', email: 'admin@example.com', email_verified: true },
    payload: { playbackPosition: 99 },
    expected: 'PERMISSION_DENIED',
    enforcedBy: "existing().status != 'ended'",
  },
  {
    id: 'P7',
    title: 'Join Attempt on Locked Room',
    path: '/rooms/SW-7F3D9/participants/viewer_2',
    operation: 'create',
    auth: { uid: 'viewer_2', email: 'viewer2@example.com', email_verified: true },
    payload: { userId: 'viewer_2', roomAdminId: 'admin_1', displayName: 'Intruder', avatar: 'cosmic', role: 'viewer', isOnline: true },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'parentRoom.data.isLocked == false',
  },
  {
    id: 'P8',
    title: 'Chat Message When Room Chat Disabled',
    path: '/rooms/SW-7F3D9/messages/msg_1',
    operation: 'create',
    auth: { uid: 'viewer_1', email: 'viewer@example.com', email_verified: true },
    payload: { senderId: 'viewer_1', roomAdminId: 'admin_1', senderName: 'Viewer', senderAvatar: 'cosmic', text: 'Bypass!' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'parentRoom.data.chatEnabled == true',
  },
  {
    id: 'P9',
    title: 'Non-Participant Message Injection',
    path: '/rooms/SW-7F3D9/messages/msg_2',
    operation: 'create',
    auth: { uid: 'outsider_9', email: 'outsider@example.com', email_verified: true },
    payload: { senderId: 'outsider_9', roomAdminId: 'admin_1', senderName: 'Outsider', senderAvatar: 'cosmic', text: 'Hello' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isRoomMember(roomId)',
  },
  {
    id: 'P10',
    title: 'Resource Poisoning With Oversized Message Text',
    path: '/rooms/SW-7F3D9/messages/msg_3',
    operation: 'create',
    auth: { uid: 'viewer_1', email: 'viewer@example.com', email_verified: true },
    payload: { senderId: 'viewer_1', roomAdminId: 'admin_1', senderName: 'Viewer', senderAvatar: 'cosmic', text: 'x'.repeat(2000) },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isValidMessage -> data.text.size() <= 600',
  },
  {
    id: 'P11',
    title: 'Client-Forged CreatedAt Timestamp',
    path: '/rooms/SW-7F3D9/messages/msg_4',
    operation: 'create',
    auth: { uid: 'viewer_1', email: 'viewer@example.com', email_verified: true },
    payload: { senderId: 'viewer_1', roomAdminId: 'admin_1', senderName: 'Viewer', senderAvatar: 'cosmic', text: 'Hi', createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'incoming().createdAt == request.time',
  },
  {
    id: 'P12',
    title: 'Unverified Email Admin Spoof',
    path: '/rooms/SW-7F3D9',
    operation: 'delete',
    auth: { uid: 'spoof_uid', email: 'jobaerulalam123@gmail.com', email_verified: false },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isAppAdmin -> request.auth.token.email_verified == true',
  },
];
