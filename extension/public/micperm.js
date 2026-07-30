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
        var name = e && e.name ? e.name : String(e);
        // No device is a different problem than a denied one — say so.
        document.body.dataset.state = name === 'NotFoundError' ? 'nodevice' : 'denied';
        if (err) {
          err.textContent = name + (e && e.message ? ' — ' + e.message : '');
        }
      });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.retry'), function (b) {
    b.addEventListener('click', ask);
  });
  document.getElementById('settings').addEventListener('click', function () {
    // chrome:// links can't be plain anchors, but tabs.create may open them.
    chrome.tabs.create({
      url: 'chrome://settings/content/siteDetails?site=' + encodeURIComponent(location.origin),
    });
  });

  ask();
})();
