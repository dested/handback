// Extension pages in a tab CAN show the getUserMedia permission prompt; the
// side panel can't (it rejects without ever prompting). This page exists to be
// that tab. Plain JS, shipped verbatim — same rule as injected.js.
(function () {
  var err = document.getElementById('err');

  function ask() {
    document.body.dataset.state = 'asking';
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(function (stream) {
        stream.getTracks().forEach(function (t) {
          t.stop();
        });
        document.body.dataset.state = 'granted';
      })
      .catch(function (e) {
        document.body.dataset.state = 'denied';
        if (err) {
          err.textContent = (e && e.name ? e.name : String(e)) + (e && e.message ? ' — ' + e.message : '');
        }
      });
  }

  document.getElementById('retry').addEventListener('click', ask);
  document.getElementById('settings').addEventListener('click', function () {
    // chrome:// links can't be plain anchors, but tabs.create may open them.
    chrome.tabs.create({
      url: 'chrome://settings/content/siteDetails?site=' + encodeURIComponent(location.origin),
    });
  });

  ask();
})();
