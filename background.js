// TODO: can we also detect common libraries like jQuery + the version loaded
// and display a warning if there are known vulnerabilities?

// TODO: display a popup to require user actions when some resources are loaded
// TODO: create HTML page to display information about sub-resources + pinning
// TODO: pin site when clicking on the browser action icon
// TODO - set state in browser.storage.local instead of in-memory (how do we
// handle async properly?)

const states = new Map();

function concatenateArrays(...arrays) {
  let totalLength = 0;
  for (let i = 0; i < arrays.length; i += 1) {
    totalLength += arrays[i].byteLength;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (let i = 0; i < arrays.length; i += 1) {
    result.set(arrays[i], offset);
    offset += arrays[i].byteLength;
  }

  return result;
}

const defaultResourcesToWatch = [
  'script',
  'main_frame',
];

let resourcesToWatch = defaultResourcesToWatch;
browser.storage.local.get().then(({ resources = defaultResourcesToWatch } = {}) => {
  resourcesToWatch = resources;
});

async function sha512(buffer) {
  const hash = await crypto.subtle.digest('SHA-512', buffer);
  const hashArray = Array.from(new Uint8Array(hash));
  return hashArray.map(b => (`00${b.toString(16)}`).slice(-2)).join('');
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const {
      documentUrl, originUrl, url, type,
    } = details;

    if (resourcesToWatch.indexOf(type) === -1) {
      return;
    }

    const documentHostname = new URL(documentUrl || originUrl || url).hostname;

    // Get state for current site
    console.error('Get state', documentHostname);
    if (!states.has(documentHostname)) {
      states.set(documentHostname, {
        resources: new Map(),
      });
    }
    const state = states.get(documentHostname);
    const { resources } = state;

    // Get info about current resource
    if (!resources.has(url)) {
      console.error('New sub-resource', url);
      resources.set(url, {
        locked: false,
        hash: null,
        cache: new Map(),
      });
    }
    const resourceState = resources.get(url);

    // Accumulator for resource body
    const chunks = [];

    // Create filter to observe loading of resource
    const filter = browser.webRequest.filterResponseData(details.requestId);

    filter.onstart = () => {
      console.error('Start loading resource', url);
      if (resourceState.locked) {
        console.error('Load pinned resource from cache', url);
        filter.write(resourceState.cache.get(resourceState.hash));
        filter.close();
      }
    };

    // If resource is not pinned, we observe the response
    if (resourceState.locked === false) {
      filter.ondata = (event) => {
        chunks.push(new Uint8Array(event.data));

        // TODO: delay the writing to the `onstop` event + decide what to do
        // based on hash. We could also ask user if it's ok to use this new
        // sub-resource or if using a previous version is desired (or even
        // getting the resource from a URL, to some released version on Github
        // for example).
        filter.write(event.data);
      };

      filter.onstop = async () => {
        console.log('End of loading', url);
        filter.disconnect();

        // Compute hash of resource
        const resource = concatenateArrays(...chunks);
        const hash = await sha512(resource);

        // Check if resource changed
        if (resourceState.hash !== null && resourceState.hash !== hash) {
          console.error('WARNING, resource is different', url);
        }

        // Update state of resource
        resourceState.cache.set(hash, resource);
        resourceState.hash = hash;

        // Auto-lock first version of
        resourceState.locked = true;
      };
    }
  },
  { urls: ['*://*/*'] },
  ['blocking'],
);
