
window.addEventListener('load', (event) => {
  console.log('LOAD', chrome.storage.local.get(['hashes']));

  // TODO - get info from background
  // TODO - render all resources loaded as well as their state
  // TODO - attach listeners to pin/unpin resources
  // TODO - all information should already be parsed/cleaned-up by background,
  // popup.js will only display the data + record user interactions.
});

window.addEventListener('unload', (event) => {
  console.log('UNLOAD');
  // TODO - remove listeners
  // TODO - push state to background? (or do it on the fly when events are
  // received?)
});
