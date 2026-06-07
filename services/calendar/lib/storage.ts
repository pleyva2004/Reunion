import { type ButterbaseClient } from '@butterbase/sdk';
import { randomUUID } from 'node:crypto';
import { createPatchedClient } from './butterbase';

export interface Participant {
  id: string;
  phone: string;
  google_email: string | null;
  created_at: string;
  updated_at: string;
}

export interface OAuthTokens {
  participant_id: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: number; // epoch ms
  scope: string;
  updated_at: string;
}

export interface Storage {
  getParticipantByPhone(phone: string): Promise<Participant | null>;
  getParticipantById(id: string): Promise<Participant | null>;
  createParticipant(phone: string): Promise<Participant>;
  updateParticipantEmail(id: string, email: string): Promise<Participant>;
  getTokens(participantId: string): Promise<OAuthTokens | null>;
  putTokens(t: OAuthTokens): Promise<void>;
  deleteTokens(participantId: string): Promise<void>;
}

// ---------------- Butterbase (production) ----------------

class ButterbaseStorage implements Storage {
  private bb: ButterbaseClient;

  constructor(opts: { appId: string; apiUrl: string; apiKey: string }) {
    this.bb = createPatchedClient(opts);
  }

  private unwrap<T>(r: { data: T | null; error: Error | null }): T | null {
    if (r.error) throw r.error;
    return r.data;
  }

  async getParticipantByPhone(phone: string) {
    const r = await this.bb
      .from<Participant>('participants')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .execute();
    const rows = this.unwrap(r);
    if (Array.isArray(rows)) return rows[0] ?? null;
    return rows;
  }

  async getParticipantById(id: string) {
    const r = await this.bb
      .from<Participant>('participants')
      .select('*')
      .eq('id', id)
      .limit(1)
      .execute();
    const rows = this.unwrap(r);
    if (Array.isArray(rows)) return rows[0] ?? null;
    return rows;
  }

  async createParticipant(phone: string) {
    const now = new Date().toISOString();
    const p: Participant = {
      id: randomUUID(),
      phone,
      google_email: null,
      created_at: now,
      updated_at: now,
    };
    const r = await this.bb.from<Participant>('participants').insert(p).select().execute();
    if (r.error) throw r.error;
    return p;
  }

  async updateParticipantEmail(id: string, email: string) {
    const updated_at = new Date().toISOString();
    const r = await this.bb
      .from<Participant>('participants')
      .update({ google_email: email, updated_at })
      .eq('id', id)
      .execute();
    if (r.error) throw r.error;
    const p = await this.getParticipantById(id);
    if (!p) throw new Error(`participant disappeared after update: ${id}`);
    return p;
  }

  async getTokens(participantId: string) {
    const r = await this.bb
      .from<OAuthTokens>('oauth_tokens')
      .select('*')
      .eq('participant_id', participantId)
      .limit(1)
      .execute();
    const rows = this.unwrap(r);
    if (Array.isArray(rows)) return rows[0] ?? null;
    return rows;
  }

  async putTokens(t: OAuthTokens) {
    const updated_at = new Date().toISOString();
    const existing = await this.getTokens(t.participant_id);
    if (existing) {
      const r = await this.bb
        .from<OAuthTokens>('oauth_tokens')
        .update({ ...t, updated_at })
        .eq('participant_id', t.participant_id)
        .execute();
      if (r.error) throw r.error;
    } else {
      const r = await this.bb
        .from<OAuthTokens>('oauth_tokens')
        .insert({ ...t, updated_at })
        .select()
        .execute();
      if (r.error) throw r.error;
    }
  }

  async deleteTokens(participantId: string) {
    const r = await this.bb
      .from<OAuthTokens>('oauth_tokens')
      .delete()
      .eq('participant_id', participantId)
      .execute();
    if (r.error) throw r.error;
  }
}

// ---------------- Memory (local dev fallback) ----------------

class MemoryStorage implements Storage {
  private participantsByPhone = new Map<string, Participant>();
  private participantsById = new Map<string, Participant>();
  private tokensByParticipantId = new Map<string, OAuthTokens>();

  async getParticipantByPhone(phone: string) {
    return this.participantsByPhone.get(phone) ?? null;
  }
  async getParticipantById(id: string) {
    return this.participantsById.get(id) ?? null;
  }
  async createParticipant(phone: string) {
    const now = new Date().toISOString();
    const p: Participant = { id: randomUUID(), phone, google_email: null, created_at: now, updated_at: now };
    this.participantsByPhone.set(phone, p);
    this.participantsById.set(p.id, p);
    return p;
  }
  async updateParticipantEmail(id: string, email: string) {
    const p = this.participantsById.get(id);
    if (!p) throw new Error(`participant not found: ${id}`);
    const updated: Participant = { ...p, google_email: email, updated_at: new Date().toISOString() };
    this.participantsById.set(id, updated);
    this.participantsByPhone.set(updated.phone, updated);
    return updated;
  }
  async getTokens(participantId: string) {
    return this.tokensByParticipantId.get(participantId) ?? null;
  }
  async putTokens(t: OAuthTokens) {
    this.tokensByParticipantId.set(t.participant_id, { ...t, updated_at: new Date().toISOString() });
  }
  async deleteTokens(participantId: string) {
    this.tokensByParticipantId.delete(participantId);
  }
}

// ---------------- Resolver ----------------

let _storage: Storage | null = null;
function getStorage(): Storage {
  if (_storage) return _storage;
  const appId = process.env.BUTTERBASE_APP_ID;
  const apiKey = process.env.BUTTERBASE_API_KEY;
  if (appId && apiKey) {
    _storage = new ButterbaseStorage({
      appId,
      apiKey,
      apiUrl: process.env.BUTTERBASE_BASE_URL ?? 'https://api.butterbase.ai',
    });
  } else {
    console.warn('[storage] BUTTERBASE_APP_ID/API_KEY not set — using in-memory storage (dev only).');
    _storage = new MemoryStorage();
  }
  return _storage;
}

// Public API — proxy to the resolved storage
export const getParticipantByPhone = (phone: string) => getStorage().getParticipantByPhone(phone);
export const getParticipantById = (id: string) => getStorage().getParticipantById(id);
export const createParticipant = (phone: string) => getStorage().createParticipant(phone);
export const updateParticipantEmail = (id: string, email: string) => getStorage().updateParticipantEmail(id, email);
export const getTokens = (id: string) => getStorage().getTokens(id);
export const putTokens = (t: OAuthTokens) => getStorage().putTokens(t);
export const deleteTokens = (id: string) => getStorage().deleteTokens(id);

export async function getOrCreateParticipantByPhone(phone: string): Promise<Participant> {
  const existing = await getParticipantByPhone(phone);
  if (existing) return existing;
  return createParticipant(phone);
}
