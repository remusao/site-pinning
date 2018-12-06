// import HashStore from './hashes';
// import Storage from './storage';

window.addEventListener('load', (/* event */) => {
  console.error('BACK???', browser.extension.getBackgroundPage().getPageInfo());
  chrome.runtime.getBackgroundPage(background => {
    console.error('BACKGROUND', JSON.stringify(Object.keys(background), undefined, 2));
  });
  // console.log('LOAD', chrome.storage.local.get(['hashes']));
  // TODO - get info from background
  // TODO - render all resources loaded as well as their state
  // TODO - attach listeners to pin/unpin resources
  // TODO - all information should already be parsed/cleaned-up by background,
  // popup.js will only display the data + record user interactions.
});

window.addEventListener('unload', (/* event */) => {
  console.log('UNLOAD');
  // TODO - remove listeners
  // TODO - push state to background? (or do it on the fly when events are
  // received?)
});
