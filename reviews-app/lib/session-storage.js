// JSON-file implementation of the @shopify/shopify-app SessionStorage
// interface. Keeps OAuth access tokens for each installed shop in
// data/sessions.json so the app survives restarts without a database.
//
// For multi-instance production deployments swap this for an official adapter
// (e.g. @shopify/shopify-app-session-storage-sqlite or -postgresql); the rest
// of the app is unaffected.

import { Session } from '@shopify/shopify-api';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(__dirname, '..', 'data', 'sessions.json');

export class JsonSessionStorage {
  #ready;

  constructor() {
    this.#ready = mkdir(dirname(FILE), { recursive: true });
  }

  async #readAll() {
    await this.#ready;
    try {
      return JSON.parse(await readFile(FILE, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return {};
      throw err;
    }
  }

  async #writeAll(map) {
    await writeFile(FILE, JSON.stringify(map, null, 2), 'utf8');
  }

  async storeSession(session) {
    const map = await this.#readAll();
    map[session.id] = session.toObject();
    await this.#writeAll(map);
    return true;
  }

  async loadSession(id) {
    const map = await this.#readAll();
    return map[id] ? new Session(map[id]) : undefined;
  }

  async deleteSession(id) {
    const map = await this.#readAll();
    if (map[id]) {
      delete map[id];
      await this.#writeAll(map);
    }
    return true;
  }

  async deleteSessions(ids) {
    const map = await this.#readAll();
    let changed = false;
    for (const id of ids) {
      if (map[id]) {
        delete map[id];
        changed = true;
      }
    }
    if (changed) await this.#writeAll(map);
    return true;
  }

  async findSessionsByShop(shop) {
    const map = await this.#readAll();
    return Object.values(map)
      .filter((s) => s.shop === shop)
      .map((s) => new Session(s));
  }
}
