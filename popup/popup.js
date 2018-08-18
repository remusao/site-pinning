document.addEventListener('DOMContentLoaded', () => {
  const display = document.getElementById('display');
  browser.tabs.query({ active: true }).then(([tab]) => {
    display.innerHTML = JSON.stringify(tab.url);
  });

  // TODO - get state from browser.storage.local
});
