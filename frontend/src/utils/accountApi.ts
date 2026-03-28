import { fetchApi } from './api';
import { AccountSnapshot } from './storage';

function getAccountHeaders(token: string, deviceId: string, includeJson = false): HeadersInit {
  return {
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${token}`,
    'X-Limitless-Device-Id': deviceId,
  };
}

export async function fetchRemoteAccountSnapshot(token: string, deviceId: string): Promise<AccountSnapshot> {
  const response = await fetchApi('/api/account', {
    method: 'GET',
    headers: getAccountHeaders(token, deviceId),
  });

  if (!response.ok) {
    throw new Error('ACCOUNT_SYNC_LOAD_FAILED');
  }

  return response.json();
}

export async function saveRemoteAccountSnapshot(
  token: string,
  deviceId: string,
  snapshot: AccountSnapshot,
): Promise<AccountSnapshot> {
  const response = await fetchApi('/api/account', {
    method: 'PUT',
    headers: getAccountHeaders(token, deviceId, true),
    body: JSON.stringify(snapshot),
  });

  if (!response.ok) {
    throw new Error('ACCOUNT_SYNC_SAVE_FAILED');
  }

  return response.json();
}
