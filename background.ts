import HashStore from './hashes';
import { ILock, IRequest } from './locks';
import Storage from './storage';

// TODO: can we also detect common libraries like jQuery + the version loaded
// and display a warning if there are known vulnerabilities?

// TODO: display a popup to require user actions when some resources are loaded
// TODO: create HTML page to display information about sub-resources + pinning
// TODO: pin site when clicking on the browser action icon
// TODO: local storage does not seem to work as expected?
// TODO: create a site-lock.json similar to NPM? This would be per tabUrl, and
// each key would be the URL of a request made to load the page. Each value
// would be some metadata: hash, timestamp, url, etc. We could then diff two
// locks to see what changes: new request, disappeared request, same request
// with different hash (we could also offer to diff a given resource?). It would
// also be trivial to display the JSON of each lock and store it. The lock would
// then be used to restore cached resources given tabUrl. We could then have a
// command like `npm audit` but for a given site. `npm install` would update the
// resources in the background (like double-fetch) and update the lock.
// Do we need to keep track of tabId/tabUrl to gather all requests for a given
// page load?
// TODO: based on a site-lock.json, reverse and find the original dependencies
// of the site? :D e.g.: `jquery=3.1`. This would allow to run the "audit"
// easily by detecting un-secure dependencies.

// `StreamFilter` is currently missing from `@types/chrome`
interface StreamFilter {
  onstart: (event: any) => void;
  ondata: (event: { data: ArrayBuffer }) => void;
  onstop: (event: any) => void;
  onerror: (event: any) => void;

  error: string;
  close(): void;
  disconnect(): void;
  write(data: ArrayBuffer): void;
}
// declare namespace chrome.webRequest {

//
//   function filterResponseData(requestId: string): StreamFilter;
// }
//

function concatenateTypedArrays(chunks: Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    totalLength += chunks[i].byteLength;
  }

  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    buffer.set(chunks[i], offset);
    offset += chunks[i].byteLength;
  }

  return buffer;
}

/**
 * Normalize URL by removing fragments, query parameters, etc.
 */
function normalizeUrl(url: string): string {
  let normalized = url;
  // Detect parameters: '?'
  const indexOfParams = normalized.indexOf('?');
  if (indexOfParams !== -1) {
    normalized = normalized.slice(0, indexOfParams);
  }

  // Detect fragments: '#'
  const indexOfFragments = normalized.indexOf('#');
  if (indexOfFragments !== -1) {
    normalized = normalized.slice(0, indexOfFragments);
  }

  return normalized.toLowerCase();
}

/**
 * Because the WebRequest API does not give us access to the URL of the page
 * each request comes from (but we know from which tab they originate), we need
 * to independently keep a mapping from tab ids to source URLs.
 */
const tabs = new Map();

function getTabUrl({ tabId }: { tabId: number }): string {
  const tabUrl = tabs.get(tabId);
  if (tabUrl !== undefined) {
    return normalizeUrl(tabUrl);
  }
  return '<unknown_tab_url>';
}

class Request {
  public timestamp: number;
  public requestId: string;
  public url: string;
  public tabUrl: string;
  public type: chrome.webRequest.ResourceType;
  public chunks: Uint8Array[];
  public fromCache: boolean;
  public tabId: number;

  public body: string | null;
  public hash: string | null;
  public resolve: (() => void) | null;
  public filter: StreamFilter;

  constructor({
    url,
    type,
    requestId,
    tabId,
    timeStamp,
  }: chrome.webRequest.WebRequestBodyDetails | chrome.webRequest.WebResponseCacheDetails) {
    this.timestamp = timeStamp;
    this.requestId = requestId;
    this.url = normalizeUrl(url);
    this.tabUrl = type === 'main_frame' ? this.url : getTabUrl({ tabId });
    this.type = type;
    this.chunks = [];
    this.fromCache = false;
    this.tabId = tabId;

    // After digest
    this.body = null;
    this.hash = null;
    this.resolve = null;

    // @ts-ignore
    this.filter = chrome.webRequest.filterResponseData(this.requestId);
  }

  public freeze(): IRequest {
    return {
      contentLength: this.body === null ? -1 : this.body.length,
      hash: this.hash,
      timestamp: this.timestamp,
      type: this.type,
      url: this.url,
    };
  }

  public disconnect() {
    try {
      this.filter.disconnect();
    } catch (ex) {
      console.error(`Could not disconnect ${this.requestId} ${ex}`);
    }

    if (this.resolve !== null) {
      this.resolve();
      this.resolve = null;
    }
  }

  public captureBody() {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.filter.onerror = () => {
        reject(this.filter.error);
      };

      this.filter.ondata = event => {
        this.addChunk(new Uint8Array(event.data));
        this.filter.write(event.data);
      };

      this.filter.onstop = () => {
        this.filter.disconnect();
        this.digest().then(resolve);
      };
    });
  }

  public addChunk(chunk: Uint8Array): void {
    this.chunks.push(chunk);
  }

  public digest() {
    const buffer = concatenateTypedArrays(this.chunks);
    const decoder = new TextDecoder('utf-8');
    this.body = decoder.decode(buffer);

    // Compute hash of full resource
    return crypto.subtle.digest('SHA-512', buffer).then(hash => {
      this.hash = Array.from(new Uint8Array(hash))
        .map(b => `00${b.toString(16)}`.slice(-2))
        .join('');
      return this.hash;
    });
  }
}

class PageLock {
  public deps: any[];
  public readonly requests: Request[];

  constructor(public readonly url: string, private readonly timestamp: number) {
    this.requests = [];
    this.deps = [];
  }

  public onNewRequest(request: Request) {
    this.requests.push(request);
  }

  /**
   * Return page-lock.json
   */
  public freeze(): ILock {
    // Sort by timestamp
    this.requests.sort((r1, r2) => {
      if (r1.timestamp < r2.timestamp) {
        return -1;
      }
      if (r1.timestamp > r2.timestamp) {
        return 1;
      }
      return 0;
    });

    // Create requests lock
    const requests: { [s: string]: IRequest } = {};
    this.requests.forEach(request => {
      requests[request.url] = request.freeze();
    });

    // TODO - keep favicon?
    return {
      deps: this.deps,
      lockfileVersion: 1,
      page: this.url,
      requests,
      timestamp: this.timestamp,
    };
  }
}

class SiteLock {
  public hashStore: HashStore;
  public storage: Storage;
  public pages: Map<number, PageLock>;
  public pendingRequests: Map<string, Request>;

  // Callbacks
  private onMessage: any;

  private onTabCreated: (tab: chrome.tabs.Tab) => void;
  private onTabRemoved: (tabId: number) => void;
  private onTabUpdated: (
    tabId: number,
    info: chrome.tabs.TabChangeInfo,
    tab: chrome.tabs.Tab,
  ) => void;

  private onBeforeRequest: (details: chrome.webRequest.WebRequestBodyDetails) => void;
  private onResponseStarted: (details: chrome.webRequest.WebResponseCacheDetails) => void;
  private onHeadersReceived: (
    details: chrome.webRequest.WebResponseHeadersDetails,
  ) => chrome.webRequest.BlockingResponse;

  constructor() {
    this.hashStore = new HashStore();
    this.storage = new Storage();

    // Keep track of currently loading pages by tabId
    this.pages = new Map();

    this.pendingRequests = new Map();

    this.onTabCreated = ({ id, url }) => {
      tabs.set(id, url);
    };

    this.onTabUpdated = (id, info, tab) => {
      const { url } = tab;
      tabs.set(id, url);

      if (info.status === 'complete') {
        setTimeout(() => {
          if (tabs.get(id) === url) {
            console.error('TAB UPDATE', id, url, info);
            this.persistPageLock(id);
          }
          // TODO - only persist after we don't see a request for this page
          // during N seconds?
        }, 30000);
      }
    };

    this.onTabRemoved = id => {
      this.persistPageLock(id);
    };

    this.onBeforeRequest = details => {
      const tabUrl = getTabUrl(details);
      if (!tabUrl) {
        console.error('Could not find sourceUrl for tab', tabUrl);
        return;
      }

      if (details.type === 'main_frame') {
        siteLock.persistPageLock(details.tabId);
      }

      // Create a new request
      const request = new Request(details);
      this.pendingRequests.set(request.requestId, request);

      request
        .captureBody()
        .then(() => {
          this.pendingRequests.delete(request.requestId);
          this.onNewRequest(request);
        })
        .catch(ex => {
          console.error('ERROR STREAMING', details.requestId, `${ex}`);
        });
    };

    this.onHeadersReceived = details => {
      let responseHeaders = details.responseHeaders || [];
      const CSP_HEADER_NAME = 'content-security-policy';
      const policies: string[] = [];

      // Collect existing CSP headers from response
      responseHeaders.forEach(({ name, value }) => {
        if (name.toLowerCase() === CSP_HEADER_NAME && value !== undefined) {
          // TODO - find a more secure solution (add more specific CSP to allow
          // the extension to inject some inline script instead of removing
          // them)
          const directives = value
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0)
            .filter(s => !s.startsWith('script-src'))
            .filter(s => !s.startsWith('default-src'));
          policies.push(...directives);
        }
      });

      // Remove all CSP headers from response
      responseHeaders = responseHeaders.filter(
        ({ name }) => name.toLowerCase() !== CSP_HEADER_NAME,
      );

      // Add updated CSP header
      responseHeaders.push({ name: CSP_HEADER_NAME, value: `${policies.join(';')};` });

      return { responseHeaders };
    };

    this.onResponseStarted = details => {
      const { fromCache, requestId } = details;
      // Request was cached so we can update the status (hash was not changed)
      if (fromCache) {
        const request = this.pendingRequests.get(requestId);
        if (request !== undefined) {
          console.error('Request was cached', request);
          request.fromCache = true;
          request.disconnect();
        } else {
          // Create a fake request
          console.error('No request pending for cached answer');
          const cachedRequest = new Request(details);
          cachedRequest.hash = '<cached>';
          siteLock.onNewRequest(cachedRequest);
        }
      }
    };

    this.onMessage = (msg: any, sender: any) => {
      console.error('MESSAGE', JSON.stringify(sender));
      if (sender.id === 'site-lock@cliqz.com') {
        const tabId = sender.tab.id;
        const url = sender.url;
        const deps = msg.deps;
        this.onNewDeps({ tabId, url, deps });
      }
    };
  }

  public init() {
    return this.storage
      .getHashes()
      .then(hashes => {
        this.hashStore.update(hashes);
      })
      .then(() => {
        // Listen for tab events
        chrome.tabs.onCreated.addListener(this.onTabCreated);
        chrome.tabs.onUpdated.addListener(this.onTabUpdated);
        chrome.tabs.onRemoved.addListener(this.onTabRemoved);

        // Listen for messages from content script
        chrome.runtime.onMessage.addListener(this.onMessage);

        const requestsFilter: { types: chrome.webRequest.ResourceType[]; urls: string[] } = {
          types: ['main_frame', 'script'],
          urls: ['<all_urls>'],
        };

        chrome.webRequest.onHeadersReceived.addListener(
          this.onHeadersReceived,
          { types: ['main_frame'], urls: ['<all_urls>'] },
          ['blocking', 'responseHeaders'],
        );

        // List for webRequest events
        chrome.webRequest.onBeforeRequest.addListener(this.onBeforeRequest, requestsFilter, [
          'blocking',
        ]);

        /**
         * Listener used to detect cached requests
         */
        chrome.webRequest.onResponseStarted.addListener(
          this.onResponseStarted,
          requestsFilter,
          [],
        );
      });
  }

  public unload() {
    chrome.tabs.onCreated.removeListener(this.onTabCreated);
    chrome.tabs.onUpdated.removeListener(this.onTabUpdated);
    chrome.tabs.onRemoved.removeListener(this.onTabRemoved);

    chrome.webRequest.onResponseStarted.removeListener(this.onResponseStarted);
    chrome.webRequest.onHeadersReceived.removeListener(this.onHeadersReceived);
    chrome.webRequest.onBeforeRequest.removeListener(this.onBeforeRequest);

    chrome.runtime.onMessage.removeListener(this.onMessage);
  }

  public persistPageLock(tabId: number): void {
    console.error('PERSIST', tabId, this.pages);
    const page = this.pages.get(tabId);
    if (page !== undefined) {
      const pageLock = page.freeze();
      this.pages.delete(tabId);
      console.error('LOCK', pageLock);
      this.storage.storeLock(pageLock);
    }
  }

  public onNewDeps({ tabId, url, deps }: { tabId: number; url: string; deps: any[] }): void {
    console.error('DEPS', tabId, url, deps);

    const pageLock = this.pages.get(tabId);
    if (pageLock !== undefined && pageLock.url === url) {
      pageLock.deps = deps;
    }
  }

  public onNewRequest(request: Request): void {
    console.error('NEW', request.requestId, request.url);
    const { tabId, tabUrl, hash, body } = request;
    let pageLock = this.pages.get(tabId);
    if (pageLock === undefined) {
      console.error('NO PAGE YET');
      pageLock = new PageLock(tabUrl, request.timestamp);
      this.pages.set(tabId, pageLock);
    } else if (pageLock.url !== tabUrl) {
      console.error('NEW PAGE LOAD', pageLock.url, 'new', tabUrl);
      this.persistPageLock(tabId);
      pageLock = new PageLock(tabUrl, request.timestamp);
      this.pages.set(tabId, pageLock);
    } else {
      console.error('SAME PAGE LOAD');
    }

    pageLock.onNewRequest(request);

    if (hash !== null && body !== null) {
      this.hashStore.update([hash]);
      Promise.all([
        this.storage.storeResource(hash, body),
        this.storage.setHashes(this.hashStore.getHashes()),
      ]);
    }
  }
}

console.log('Start site lock...');
const siteLock = new SiteLock();
siteLock
  .init()
  .then(() => {
    console.error('Ready to roll!');
  })
  .catch(ex => {
    console.error(`Error while initializing: ${ex}`);
  });

/**
 * Function exposed to popup to get all information about the current page
 * TODO - prevent rollup from tree-shaking this one
 */
function getPageInfo() {
  return { lock: 'test' };
}
