/* ============================================================
     IMAGE CAPTCHA
     ------------------------------------------------------------
     generateCaptcha() only redraws when the canvas actually
     changes size. Mobile browsers fire `resize` while scrolling
     (URL bar hide/show) — without this guard the CAPTCHA would
     change mid-scroll. Use refreshCaptcha() to force a new code.
     ============================================================ */
  let captchaText = '';
  let captchaRenderedWidth = 0;

  function generateCaptcha(force) {
    const canvas = document.getElementById('captchaCanvas');
    if (!canvas || !canvas.getContext) return;

    const cssW = parseFloat(getComputedStyle(canvas).width) || 170;
    const cssH = parseFloat(getComputedStyle(canvas).height) || 54;

    if (!force && captchaRenderedWidth > 0 && Math.abs(cssW - captchaRenderedWidth) < 2) return;
    captchaRenderedWidth = cssW;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = cssW, h = cssH;

    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#1a1a22'); bg.addColorStop(1, '#07070a');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = 'hsla(' + (Math.random() * 360) + ', 70%, 60%, 0.35)';
      ctx.lineWidth = 1 + Math.random() * 1.4;
      ctx.beginPath();
      ctx.moveTo(Math.random() * w, Math.random() * h);
      ctx.bezierCurveTo(Math.random() * w, Math.random() * h, Math.random() * w, Math.random() * h, Math.random() * w, Math.random() * h);
      ctx.stroke();
    }
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = 'hsla(' + (Math.random() * 360) + ', 70%, 65%, 0.45)';
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, Math.random() * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const len = 5;
    let text = '';
    const slotW = w / (len + 1);

    for (let i = 0; i < len; i++) {
      const ch = chars[Math.floor(Math.random() * chars.length)];
      text += ch;
      ctx.save();
      ctx.translate(slotW * (i + 0.95), h / 2 + 6);
      ctx.rotate((Math.random() - 0.5) * 0.65);
      const fontSize = Math.round(h * (0.52 + Math.random() * 0.14));
      ctx.font = '800 ' + fontSize + 'px "Plus Jakarta Sans", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 1;
      const hue = Math.random() * 60;
      const light = 62 + Math.random() * 20;
      ctx.fillStyle = 'hsl(' + hue + ', 95%, ' + light + '%)';
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    }

    captchaText = text;
    const inp = document.getElementById('captchaAnswer');
    if (inp) inp.value = '';
    const err = document.getElementById('captchaError');
    if (err) err.textContent = '';
  }

  /* Only regenerates the CAPTCHA — never touches the form status message. */
  function refreshCaptcha() {
    generateCaptcha(true);
  }

  /* ============================================================
     FORM SUBMIT
     ============================================================ */
  async function handleFormSubmit(event) {
    event.preventDefault();

    const nameEl = document.getElementById('name');
    const emailEl = document.getElementById('email');
    const phoneEl = document.getElementById('phone');
    const msgEl = document.getElementById('message');
    const capEl = document.getElementById('captchaAnswer');
    const statusEl = document.getElementById('formStatus');
    const btn = document.getElementById('submitBtn');

    const name = nameEl ? nameEl.value.trim() : '';
    const email = emailEl ? emailEl.value.trim() : '';
    const phone = phoneEl ? phoneEl.value.trim() : '';
    const message = msgEl ? msgEl.value.trim() : '';
    const captcha = capEl ? capEl.value.trim() : '';

    const setStatus = (msg, cls) => {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.className = 'form-status ' + (cls || '');
    };

    if (!name || !email || !message) { setStatus('Please fill in your name, email and message.', 'error'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setStatus('Please enter a valid email address.', 'error'); return; }
    if (!captcha) {
      const err = document.getElementById('captchaError');
      if (err) err.textContent = 'Please type the code shown in the image.';
      setStatus('Verification required.', 'error');
      return;
    }
    if (captcha.toUpperCase() !== captchaText.toUpperCase()) {
      const err = document.getElementById('captchaError');
      if (err) err.textContent = 'Incorrect code. Here is a new one.';
      setStatus('Verification failed — please try again.', 'error');
      generateCaptcha(true);
      return;
    }

    const payload = { name, email, phone, message, page: location.href, submittedAt: new Date().toISOString() };

    if (btn) { btn.disabled = true; }
    const originalBtnText = btn ? btn.textContent : '';
    if (btn) btn.textContent = 'Sending…';
    setStatus('', '');

    try {
      if (FORM_CONFIG.appsScriptUrl) {
        await fetch(FORM_CONFIG.appsScriptUrl, {
          method: 'POST', mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(payload)
        });
      } else if (FORM_CONFIG.googleFormAction && FORM_CONFIG.googleFormFields.name) {
        const f = FORM_CONFIG.googleFormFields;
        const body = new URLSearchParams();
        body.append(f.name, name);
        body.append(f.email, email);
        if (f.phone) body.append(f.phone, phone);
        body.append(f.message, message);
        await fetch(FORM_CONFIG.googleFormAction, {
          method: 'POST', mode: 'no-cors',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString()
        });
      } else {
        throw new Error('Inquiry form is not connected.');
      }

      setStatus('Your submission was sent. If you do not hear back, please contact us directly.', 'success');
      document.getElementById('projectForm').reset();
      generateCaptcha(true);
    } catch (err) {
      console.error('[ADDABAAZ] Inquiry submit failed:', err);
      setStatus('Something went wrong. Please use the direct contact details on this page.', 'error');
      generateCaptcha(true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalBtnText || 'Send Message'; }
    }
  }
