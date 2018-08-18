const resources = new Map();

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const filter = browser.webRequest.filterResponseData(details.requestId);
    let decoder = new TextDecoder("utf-8");
    let encoder = new TextEncoder();

    filter.onstart = event => {

    };

    filter.ondata = event => {
      let str = decoder.decode(event.data, { stream: true });

      // Just change any instance of Example in the HTTP response
      // to WebExtension Example.
      str = str.replace(/Example/g, 'WebExtension Example');
      filter.write(event.data);
    };

    filter.onstop = event => {
      filter.disconnect();
    };
  },
  { urls: ['*://*/*'] },
  ["blocking"]
);
