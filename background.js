// Opens the viewer with the current tab's URL.
chrome.action.onClicked.addListener((tab) => {
  const url = tab.url && /^(https?|file):/.test(tab.url) ? tab.url : '';
  chrome.tabs.create({
    url: chrome.runtime.getURL('viewer.html') + (url ? '?url=' + encodeURIComponent(url) : ''),
    index: tab.index + 1,
  });
});

// The rule that strips X-Frame-Options/CSP is scoped to the viewer tab; clean it up on close.
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] }).catch(() => {});
});
