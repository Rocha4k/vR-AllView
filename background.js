// open the viewer with the current tab's url
chrome.action.onClicked.addListener((tab) => {
  const url = tab.url && /^(https?|file):/.test(tab.url) ? tab.url : '';
  chrome.tabs.create({
    url: chrome.runtime.getURL('viewer.html') + (url ? '?url=' + encodeURIComponent(url) : ''),
    index: tab.index + 1,
  });
});

// drop the viewer tab's header rule when it closes
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] }).catch(() => {});
});
