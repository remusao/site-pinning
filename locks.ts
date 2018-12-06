export interface IRequest {
  hash: string | null; // TODO - prevent `null`
  timestamp: number | null; // TODO - prevent `null`
  type: chrome.webRequest.ResourceType;
  url: string;
  contentLength: number;
}

export interface ILock {
  lockfileVersion: number;
  deps: any[];
  page: string;
  requests: { [url: string]: IRequest };
  timestamp: number;
}

export interface ILockDiff {
  added: IRequest[];
  removed: IRequest[];
  changed: IRequest[];
}

/**
 * Given two locks for the same page, compare them and find differences (e.g.:
 * new request, disappeared requests, changed requests)
 */
export function diffLocks(lock1: ILock, lock2: ILock): ILockDiff {
  const result: ILockDiff = {
    added: [],
    changed: [],
    removed: [],
  };

  [...Object.keys(lock1.requests), ...Object.keys(lock2.requests)].forEach(url => {
    const meta2 = lock2.requests[url];
    const meta1 = lock1.requests[url];
    if (meta1 === undefined) {
      result.added.push(meta2);
    } else if (meta2 === undefined) {
      result.removed.push(meta1);
    } else if (meta1.hash !== meta2.hash && meta2.hash !== '<cached>') {
      result.changed.push(meta2);
    }
  });

  return result;
}
