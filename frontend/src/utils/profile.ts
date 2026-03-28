import { AccountProfile } from '../types';

const PROFILE_ADJECTIVES = [
  'Neon',
  'Ghost',
  'Nova',
  'Cipher',
  'Lunar',
  'Solar',
  'Echo',
  'Velvet',
  'Orbit',
  'Quantum',
  'Pixel',
  'Silent',
];

const PROFILE_NOUNS = [
  'Fox',
  'Pulse',
  'Raven',
  'Vector',
  'Signal',
  'Drift',
  'Node',
  'Spark',
  'Comet',
  'Shade',
  'Flux',
  'Scope',
];

function stableHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function buildProfileId(hash: number): string {
  const left = hash.toString(36).toUpperCase().padStart(6, '0').slice(0, 4);
  const mixed = Math.imul(hash ^ 0x9e3779b9, 2654435761) >>> 0;
  const right = mixed.toString(36).toUpperCase().padStart(6, '0').slice(0, 3);
  return `LX-${left}${right}`;
}

function buildNickname(hash: number): string {
  const adjective = PROFILE_ADJECTIVES[hash % PROFILE_ADJECTIVES.length];
  const noun = PROFILE_NOUNS[(hash >>> 7) % PROFILE_NOUNS.length];
  const suffix = ((hash >>> 15) % 900) + 100;
  return `${adjective}${noun}${suffix}`;
}

export function createDeterministicProfile(token?: string | null): AccountProfile {
  const source = token?.trim() || 'limitless-guest';
  const hash = stableHash(source);

  return {
    profileId: buildProfileId(hash),
    nickname: buildNickname(hash),
    avatarDataUrl: null,
    avatarHue: hash % 360,
    createdAt: null,
  };
}

export function normalizeAccountProfile(
  profile: Partial<AccountProfile> | null | undefined,
  token?: string | null,
): AccountProfile {
  const fallbackProfile = createDeterministicProfile(token);

  return {
    profileId: profile?.profileId?.trim() || fallbackProfile.profileId,
    nickname: profile?.nickname?.trim() || fallbackProfile.nickname,
    avatarDataUrl: profile?.avatarDataUrl?.trim() || null,
    avatarHue: typeof profile?.avatarHue === 'number' ? profile.avatarHue : fallbackProfile.avatarHue,
    createdAt: profile?.createdAt ?? fallbackProfile.createdAt,
  };
}

export function initialsFromNickname(nickname: string): string {
  const cleaned = nickname.trim();
  if (!cleaned) {
    return 'LX';
  }

  const chunks = cleaned
    .split(/[\s_-]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (chunks.length >= 2) {
    return `${chunks[0][0]}${chunks[1][0]}`.toUpperCase();
  }

  return cleaned.slice(0, 2).toUpperCase();
}
