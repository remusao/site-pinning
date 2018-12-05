// TODO: can we also detect common libraries like jQuery + the version loaded
// and display a warning if there are known vulnerabilities?

// TODO: display a popup to require user actions when some resources are loaded
// TODO: create HTML page to display information about sub-resources + pinning
// TODO: pin site when clicking on the browser action icon
// TODO - set state in browser.storage.local instead of in-memory (how do we
// handle async properly?)

/**
 * Normalize URL by removing fragments, query parameters, etc.
 */
function normalizeUrl(url) {
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

chrome.tabs.onCreated.addListener(({ id, url }) => {
  tabs.set(id, url);
});

chrome.tabs.onUpdated.addListener((id, _, { url }) => {
  tabs.set(id, url);
});

function getTabUrl({ tabId }) {
  const tabUrl = tabs.get(tabId);
  if (tabUrl !== undefined) {
    return normalizeUrl(tabUrl);
  }
  return undefined;
}

class Request {
  constructor({
    url, type, requestId, tabId, timeStamp,
  }) {
    this.timestamp = timeStamp;
    this.requestId = requestId;
    this.tabUrl = getTabUrl({ tabId });
    this.url = normalizeUrl(url);
    this.type = type;
    this.chunks = [];
    this.fromCache = false;

    // After digest
    this.body = null;
    this.hash = null;
    this.resolve = null;
  }

  captureBody() {
    const filter = browser.webRequest.filterResponseData(this.requestId);
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      filter.onerror = reject;

      filter.ondata = (event) => {
        this.addChunk(new Uint8Array(event.data));
        filter.write(event.data);
      };

      filter.onstop = () => {
        filter.disconnect();

        this.digest().then(resolve);
      };
    });
  }

  addChunk(chunk) {
    this.chunks.push(chunk);
  }

  async digest() {
    let totalLength = 0;
    for (let i = 0; i < this.chunks.length; i += 1) {
      totalLength += this.chunks[i].byteLength;
    }

    // Concatenate all chunks of data for this request
    const fullContent = new Uint8Array(totalLength);
    let offset = 0;
    for (let i = 0; i < this.chunks.length; i += 1) {
      fullContent.set(this.chunks[i], offset);
      offset += this.chunks[i].byteLength;
    }

    const decoder = new TextDecoder('utf8');
    this.body = btoa(decoder.decode(fullContent));

    // Compute hash of full resource
    const hash = await crypto.subtle.digest('SHA-512', fullContent);
    this.hash = Array.from(new Uint8Array(hash))
      .map(b => `00${b.toString(16)}`.slice(-2))
      .join('');

    return this.hash;
  }
}

class SiteLock {
  constructor() {
    this.hashes = new Set();
    this.cache = new Map();
  }

  init() {
    const hashesPromises = chrome.storage.local.get('hashes');
    if (hashesPromises !== undefined) {
      return hashesPromises.then((hashes) => {
        console.error('Hashes', hashes);
        this.hashes = new Set(hashes);
      });
    }

    return Promise.resolve();
  }

  isPageLocked({ url }) {
    // TODO check if this page was locked before
    return false;
  }

  async persistRequest(request) {
    const {
      body, hash, tabUrl, url, timestamp, fromCache,
    } = request;
    const promises = [];

    if (fromCache) {
      console.error('Request was from cache');
      // TODO - do some book-keeping
      return;
    }

    if (!this.hashes.has(hash)) {
      // Update list of hashes
      this.hashes.add(hash);
      promises.push(
        chrome.storage.local.set({
          hashes: [...this.hashes],
        }),
      );

      // Update resource associated to hash
      promises.push(
        chrome.storage.local.set({
          [hash]: body,
        }),
      );
    }

    // Get requests of current tabUrl
    if (!this.cache.has(tabUrl)) {
      const pageState = (await chrome.storage.local.get(tabUrl)) || {};
      this.cache.set(tabUrl, pageState);
    }

    const requests = this.cache.get(tabUrl);

    if (requests[url] === undefined) {
      console.error(`New request for ${tabUrl}: ${url} (${hash})`);
      requests[url] = [{
        timestamp,
        hash,
      }];
      promises.push(
        chrome.storage.local.set({
          [tabUrl]: requests,
        }),
      );
    } else {
      // Not the first time, compare hash
      const hashes = requests[url];
      const lastHash = hashes[hashes.length - 1].hash;
      if (lastHash !== hash) {
        console.error(`Hash changed since last time for ${url}: ${lastHash} vs. ${hash}`);
        hashes.push({
          timestamp, hash,
        });
        promises.push(
          chrome.storage.local.set({
            [tabUrl]: requests,
          }),
        );
      } else {
        console.error('Resource did not change!');
      }
    }

    await Promise.all(promises);
  }
}

const pendingRequests = new Map();

console.log('Start site lock...');
const siteLock = new SiteLock();
siteLock.init().then(() => {
  console.log('Ready to roll!');

  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      const tabUrl = getTabUrl(details);
      if (!tabUrl) {
        console.error('Could not find sourceUrl for tab', tabUrl);
        return;
      }

      if (siteLock.isPageLocked(details)) {
        // TODO - restore chunks if cached
        // const { resources } = state;
        // // Get info about current resource
        // if (!resources.has(url)) {
        //   console.error('New sub-resource', url);
        //   resources.set(url, {
        //     locked: false,
        //     hash: null,
        //     cache: new Map(),
        //   });
        // }
        // const resourceState = resources.get(url);
        // filter.onstart = () => {
        // console.error('Start loading resource', details.url);
        // if (resourceState.locked) {
        //   console.error('Load pinned resource from cache', url);
        //   filter.write(resourceState.cache.get(resourceState.hash));
        //   filter.close();
        // }
        // };
      } else {
        const request = new Request(details);
        pendingRequests.set(request.requestId, request);

        console.error('REQUEST', request);
        request.captureBody().then(() => {
          pendingRequests.delete(request.requestId);
          siteLock.persistRequest(request);
        });
      }
    },
    {
      urls: ['<all_urls>'],
      types: [
        'main_frame',
        'script',
      ],
    },
    ['blocking'],
  );

  /**
   * Listener used to detect cached requests
   */
  browser.webRequest.onResponseStarted.addListener(
    ({
      fromCache, requestId,
    }) => {
      // Request was cached so we can update the status (hash was not changed)
      if (fromCache) {
        const request = pendingRequests.get(requestId);
        if (request !== undefined) {
          request.fromCache = true;
          request.resolve();
        }
      }
    },
    {
      urls: ['<all_urls>'],
      types: [
        'main_frame',
        'script',
      ],
    },
    [],
  );
});
