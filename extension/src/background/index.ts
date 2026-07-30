// Stub — replaced by the real service worker in the parallel build.
chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
  sendResponse({ ok: true });
  return true;
});
