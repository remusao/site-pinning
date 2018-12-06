import localforage from 'localforage';
import { ILock } from './locks';

export default class Storage {
  private storage: LocalForage;

  constructor() {
    this.storage = localforage.createInstance({
      name: 'site-lock',
    });
  }

  /**
   * Resources management
   */

  public setHashes(hashes: string[]): Promise<string[]> {
    return this.storage.setItem('hashes', hashes);
  }

  public getHashes(): Promise<string[]> {
    return this.storage.getItem('hashes').then(hashes => {
      if (hashes === null) {
        return [];
      }

      // The result needs to be casted explicitely to an array
      return hashes as string[];
    });
  }

  public storeResource(hash: string, body: string): Promise<string> {
    return this.storage.setItem(hash, body);
  }

  public getResource(hash: string): Promise<string | null> {
    return this.storage.getItem(hash);
  }

  // TODO - keep track of versions for each `(url, type, tabUrl)` (maybe list of hash is
  // enough, with timestamp).

  /**
   * Page-locks management
   */

  public getLocks(url: string): Promise<ILock[]> {
    return this.storage.getItem(url).then(locks => {
      if (locks === null) {
        return [];
      }
      return locks as ILock[];
    });
  }

  public getLatestLock(url: string): Promise<ILock | null> {
    return this.getLocks(url).then(locks => {
      if (locks.length === 0) {
        return null;
      }
      return locks[locks.length - 1] as ILock;
    });
  }

  public storeLock(lock: ILock): Promise<void> {
    return this.getLocks(lock.page)
      .then(locks => this.storage.setItem(lock.page, [...locks, lock]))
      .then(() => {
        /* No return value */
      });
  }
}
