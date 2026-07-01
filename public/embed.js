(function () {
  const script = document.currentScript;
  const siteId = script.getAttribute("data-site-id");

  if (!siteId) {
    console.error("TrueCatch: missing data-site-id attribute.");
    return;
  }

  const scriptUrl = new URL(script.src);
  const API_BASE = `${scriptUrl.origin}/api/public`;

  // ── Anonymous visitor identity ──────────────────────────────
  let visitorId = localStorage.getItem("tc_visitor_id");
  if (!visitorId) {
    visitorId = "v_" + Math.random().toString(36).slice(2) + Date.now();
    localStorage.setItem("tc_visitor_id", visitorId);
  }

  let knownEmail = localStorage.getItem("tc_email") || null;

  // ── Rich context — captured automatically ───────────────────
  function getContext() {
    return {
      url: window.location.href,
      title: document.title,
      referrer: document.referrer || null,
      screen: `${window.screen.width}x${window.screen.height}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
    };
  }

  // ── Public SDK ───────────────────────────────────────────────
  window.TrueCatch = {
    track: function (type, metadata) {
      fetch(`${API_BASE}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteId,
          visitorId,
          email: knownEmail,
          type,
          metadata: metadata || {},
          context: getContext(),
        }),
      }).catch((err) => console.error("TrueCatch: track failed", err));
    },

    identify: function (email, traits) {
      knownEmail = email;
      localStorage.setItem("tc_email", email);
      window.TrueCatch.track("identify", { email, ...traits });
    },

    page: function () {
      window.TrueCatch.track("page_view", {
        url: window.location.href,
        title: document.title,
        referrer: document.referrer || null,
      });
    },
  };

  // Auto-track page view
  window.TrueCatch.page();

  // ── Load widgets ─────────────────────────────────────────────
  fetch(`${API_BASE}/site/${siteId}`)
    .then((res) => res.json())
    .then(({ widgets }) => {
      if (!widgets) return;

      if (widgets.popups && widgets.popups.length > 0) {
        const popup = widgets.popups[0];
        setTimeout(() => showPopup(popup), popup.delaySeconds * 1000);
      }

      if (widgets.toasters && widgets.toasters.length > 0) {
        const toaster = widgets.toasters[0];
        if (toaster.triggerType === "immediate") {
          showToaster(toaster);
        } else {
          setTimeout(() => showToaster(toaster), toaster.delaySeconds * 1000);
        }
      }
    })
    .catch((err) => console.error("TrueCatch: failed to load widgets", err));

  // ── Popup ────────────────────────────────────────────────────
  function showPopup(popup) {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:fixed;bottom:24px;right:24px;max-width:320px;
      background:white;border-radius:12px;
      box-shadow:0 10px 30px rgba(0,0,0,0.15);
      padding:20px;font-family:Arial,sans-serif;z-index:999999;
    `;

    overlay.innerHTML = `
      <button id="tc-close" style="position:absolute;top:8px;right:10px;border:none;background:none;font-size:16px;cursor:pointer;color:#888;">✕</button>
      <h3 style="margin:0 0 8px;font-size:18px;color:#111;">${popup.title}</h3>
      <p style="margin:0 0 14px;font-size:14px;color:#555;">${popup.message}</p>
      <div style="display:flex;gap:8px;">
        <input id="tc-email" type="email" placeholder="you@example.com"
          style="flex:1;padding:8px 10px;border:1px solid #ccc;border-radius:8px;font-size:14px;" />
        <button id="tc-submit"
          style="background:#4f46e5;color:white;border:none;padding:8px 14px;border-radius:8px;font-size:14px;cursor:pointer;white-space:nowrap;">
          ${popup.buttonText}
        </button>
      </div>
      <p id="tc-msg" style="margin:10px 0 0;font-size:13px;color:#16a34a;display:none;"></p>
      <p style="margin:8px 0 0;font-size:10px;color:#ccc;text-align:right;">Powered by TrueCatch</p>
    `;

    document.body.appendChild(overlay);

    window.TrueCatch.track("popup_viewed", {
      popupId: popup.id,
      popupTitle: popup.title,
    });

    document.getElementById("tc-close").addEventListener("click", () => {
      window.TrueCatch.track("popup_closed", { popupId: popup.id });
      overlay.remove();
    });

    document.getElementById("tc-submit").addEventListener("click", () => {
      const email = document.getElementById("tc-email").value;
      if (!email) return;

      knownEmail = email;
      localStorage.setItem("tc_email", email);

      fetch(`${API_BASE}/popups/${popup.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          visitorId,
          context: getContext(),
        }),
      })
        .then((res) => res.json())
        .then(() => {
          // Fire merged event so all previous anonymous events get linked
          window.TrueCatch.track("popup_submitted", {
            popupId: popup.id,
            popupTitle: popup.title,
          });

          const msg = document.getElementById("tc-msg");
          msg.textContent = "Thanks! You're in. 🎉";
          msg.style.display = "block";
          document.getElementById("tc-email").style.display = "none";
          document.getElementById("tc-submit").style.display = "none";
        })
        .catch((err) => console.error("TrueCatch: submit failed", err));
    });
  }

  // ── Toaster ──────────────────────────────────────────────────
  function showToaster(toaster) {
    const bar = document.createElement("div");
    bar.style.cssText = `
      position:fixed;top:0;left:0;right:0;
      background:${toaster.bgColor || "#111827"};color:white;
      padding:10px 16px;display:flex;align-items:center;
      justify-content:center;gap:12px;
      font-family:Arial,sans-serif;font-size:14px;z-index:999998;
    `;

    bar.innerHTML = `
      <span>${toaster.message}</span>
      ${
        toaster.ctaText && toaster.ctaUrl
          ? `<a href="${toaster.ctaUrl}" target="_blank"
            style="background:white;color:${toaster.bgColor || "#111827"};padding:4px 12px;border-radius:20px;font-size:13px;font-weight:600;text-decoration:none;">
            ${toaster.ctaText}
           </a>`
          : ""
      }
      <button id="tc-toast-close"
        style="background:none;border:none;color:white;font-size:18px;cursor:pointer;margin-left:auto;opacity:0.7;">✕</button>
    `;

    document.body.style.paddingTop = "44px";
    document.body.prepend(bar);

    window.TrueCatch.track("toaster_viewed", { toasterId: toaster.id });

    document.getElementById("tc-toast-close").addEventListener("click", () => {
      window.TrueCatch.track("toaster_closed", { toasterId: toaster.id });
      bar.remove();
      document.body.style.paddingTop = "0";
    });
  }
})();
