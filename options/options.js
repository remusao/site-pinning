/* eslint-disable no-param-reassign */

// Restore settings when option page is opened
browser.storage.local.get().then(({ resources = [] } = {}) => {
  [...document.querySelectorAll('.resource-types [type=checkbox]')].forEach((item) => {
    if (resources.indexOf(item.getAttribute('data-type')) !== -1) {
      item.checked = true;
    } else {
      item.checked = false;
    }
  });
}, e => console.error(e));


// Save settings modifications in browser.storage
[...document.querySelectorAll('.resource-types [type=checkbox]')].forEach((checkbox) => {
  checkbox.addEventListener('click', () => {
    browser.storage.local.set({
      resources: [...document.querySelectorAll('.resource-types [type=checkbox]')]
        .filter(item => item.checked)
        .map(item => item.getAttribute('data-type')),
    });
  });
});
