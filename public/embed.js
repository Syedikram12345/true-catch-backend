(function () {
  const script = document.currentScript;
  const popupId = script.getAttribute("data-popup-id");

  if (!popupId) {
    console.error("TrueCatch: missing data-popup-id attribute on script tag.");
    return;
  }

  // Derive the API base from wherever this script itself was loaded from
  const scriptUrl = new URL(script.src);
  const API_BASE = `${scriptUrl.origin}/api/public`;

  fetch(`${API_BASE}/popups/${popupId}`)
    .then((res) => res.json())
    .then(({ popup }) => {
      if (!popup) return;
      setTimeout(() => showPopup(popup), popup.delaySeconds * 1000);
    })
    .catch((err) => console.error("TrueCatch: failed to load popup", err));

  function showPopup(popup) {
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
})();
