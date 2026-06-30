(function () {
  const script = document.currentScript;
  const siteId = script.getAttribute("data-site-id");

  if (!siteId) {
    console.error("TrueCatch: missing data-site-id attribute on script tag.");
    return;
  }

  const scriptUrl = new URL(script.src);
  const API_BASE = `${scriptUrl.origin}/api/public`;

  fetch(`${API_BASE}/site/${siteId}`)
    .then((res) => res.json())
    .then(({ widgets }) => {
      if (!widgets) return;

      // Handle popups
      if (widgets.popups && widgets.popups.length > 0) {
        const popup = widgets.popups[0];
        setTimeout(() => showPopup(popup, API_BASE), popup.delaySeconds * 1000);
      }

      // Handle toasters
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

  function showPopup(popup, API_BASE) {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.bottom = "24px";
    overlay.style.right = "24px";
    overlay.style.maxWidth = "320px";
    overlay.style.background = "white";
    overlay.style.borderRadius = "12px";
    overlay.style.boxShadow = "0 10px 30px rgba(0,0,0,0.15)";
    overlay.style.padding = "20px";
    overlay.style.fontFamily = "Arial, sans-serif";
    overlay.style.zIndex = "999999";

    overlay.innerHTML = `
      <button id="tc-close" style="position:absolute;top:8px;right:10px;border:none;background:none;font-size:16px;cursor:pointer;color:#888;">✕</button>
      <h3 style="margin:0 0 8px;font-size:18px;color:#111;">${popup.title}</h3>
      <p style="margin:0 0 14px;font-size:14px;color:#555;">${popup.message}</p>
      <div style="display:flex;gap:8px;">
        <input id="tc-email" type="email" placeholder="you@example.com" style="flex:1;padding:8px 10px;border:1px solid #ccc;border-radius:8px;font-size:14px;" />
        <button id="tc-submit" style="background:#4f46e5;color:white;border:none;padding:8px 14px;border-radius:8px;font-size:14px;cursor:pointer;white-space:nowrap;">${popup.buttonText}</button>
      </div>
      <p id="tc-message" style="margin:10px 0 0;font-size:13px;color:#16a34a;display:none;"></p>
      <p style="margin:8px 0 0;font-size:10px;color:#ccc;text-align:right;">Powered by TrueCatch</p>
    `;

    document.body.appendChild(overlay);

    document.getElementById("tc-close").addEventListener("click", () => {
      overlay.remove();
    });

    document.getElementById("tc-submit").addEventListener("click", () => {
      const email = document.getElementById("tc-email").value;
      if (!email) return;

      fetch(`${API_BASE}/popups/${popup.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
        .then((res) => res.json())
        .then(() => {
          const msg = document.getElementById("tc-message");
          msg.textContent = "Thanks! You're in. 🎉";
          msg.style.display = "block";
          document.getElementById("tc-email").style.display = "none";
          document.getElementById("tc-submit").style.display = "none";
        })
        .catch((err) => console.error("TrueCatch: submit failed", err));
    });
  }

  function showToaster(toaster) {
    const bar = document.createElement("div");
    bar.style.position = "fixed";
    bar.style.top = "0";
    bar.style.left = "0";
    bar.style.right = "0";
    bar.style.background = toaster.bgColor || "#111827";
    bar.style.color = "white";
    bar.style.padding = "10px 16px";
    bar.style.display = "flex";
    bar.style.alignItems = "center";
    bar.style.justifyContent = "center";
    bar.style.gap = "12px";
    bar.style.fontFamily = "Arial, sans-serif";
    bar.style.fontSize = "14px";
    bar.style.zIndex = "999998";

    bar.innerHTML = `
      <span>${toaster.message}</span>
      ${
        toaster.ctaText && toaster.ctaUrl
          ? `<a href="${toaster.ctaUrl}" target="_blank" style="background:white;color:${toaster.bgColor || "#111827"};padding:4px 12px;border-radius:20px;font-size:13px;font-weight:600;text-decoration:none;">${toaster.ctaText}</a>`
          : ""
      }
      <button id="tc-toast-close" style="background:none;border:none;color:white;font-size:18px;cursor:pointer;margin-left:auto;opacity:0.7;">✕</button>
    `;

    document.body.style.paddingTop = "44px";
    document.body.prepend(bar);

    document.getElementById("tc-toast-close").addEventListener("click", () => {
      bar.remove();
      document.body.style.paddingTop = "0";
    });
  }
})();
