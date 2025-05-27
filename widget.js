/* ---------------------------------------------
   widget.js — Widget Factory Master Controller
   Naming aligned with widgets.css & Webflow DOM
   --------------------------------------------- */

/* 0 · Runtime guard (avoid double‑loading) */
if (window.WidgetFactoryLoaded) {
  console.warn('Widget Factory already loaded — skipping init');
} else {
  window.WidgetFactoryLoaded = true;
}

/* 1 · WidgetShell orchestrates one <section data-widget="…"> */
class WidgetShell {
  constructor(rootEl, opts = {}) {
    /* ─ Dataset hooks ─ */
    this.rootEl          = rootEl;                        // <section data-widget="merge-pdf" …>
    this.widgetSlug      = rootEl.dataset.widget;          // "merge-pdf"
    this.presignEndpoint = rootEl.dataset.presignEndpoint || opts.presignEndpoint;
    this.processEndpoint = rootEl.dataset.processEndpoint || opts.processEndpoint;

    /* ─ Child components (data-component) ─ */
    this.fileInput   = rootEl.querySelector('[data-component="FileInput"]');
    this.progressBar = rootEl.querySelector('[data-component="ProgressBar"]');
    this.resultCard  = rootEl.querySelector('[data-component="ResultCard"]');

    /* ─ Wire listeners & anon‑ID ─ */
    this.initFileInput();
    this.anonId = this.getAnonId();
  }

  /* 1.1 FileInput → drag‑drop & picker */
  initFileInput() {
    if (!this.fileInput) return;

    const dropzone = this.fileInput.querySelector('.dropzone');
    const input    = this.fileInput.querySelector('input[type="file"]');

    /* Highlight on drag */
    ['dragenter', 'dragover'].forEach(evt =>
      dropzone.addEventListener(evt, e => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      })
    );
    ['dragleave', 'drop'].forEach(evt =>
      dropzone.addEventListener(evt, () => dropzone.classList.remove('dragover'))
    );

    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      this.handleFiles(e.dataTransfer.files);
    });

    input.addEventListener('change', () => this.handleFiles(input.files));
    dropzone.addEventListener('click', () => input.click());
  }

  /* 1.2 Persistent anon ID for credit logic */
  getAnonId() {
    let id = localStorage.getItem('wf_anon_id');
    if (!id) {
      id = 'anon_' + Math.random().toString(36).slice(2, 11);
      localStorage.setItem('wf_anon_id', id);
    }
    return id;
  }

  /* 2 · Main flow — presign → upload → process */
  async handleFiles(files) {
    if (!files || !files.length) return;

    this.resetResult();
    this.showProgress();

    const fileKeys = [];
    for (const file of files) {
      try {
        /* 2.1 Get presigned URL */
        const pre = await fetch(this.presignEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            anon_id: this.anonId,
            widget:  this.widgetSlug,
            mime:    file.type,
            size:    file.size
          })
        });
        if (!pre.ok) throw new Error('Presign failed');
        const { uploadUrl, key } = await pre.json();

        /* 2.2 Upload */
        const up = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body:   file
        });
        if (!up.ok) throw new Error('Upload failed');
        fileKeys.push(key);
      } catch (err) {
        console.error(err);
        return this.showError(err.message);
      }
    }

    /* 2.3 Notify processor */
    try {
      const proc = await fetch(this.processEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anon_id: this.anonId,
          widget:  this.widgetSlug,
          files:   fileKeys.map(k => ({ bucket: 'widget-uploads', key: k }))
        })
      });
      if (!proc.ok) throw new Error('Processing failed');
      const payload = await proc.json();
      this.displayResult(payload);
    } catch (err) {
      console.error(err);
      this.showError(err.message);
    }
  }

  /* 3 · Progress helpers */
  showProgress() {
    if (!this.progressBar) return;
    const bar = this.progressBar.querySelector('.progress-bar');
    this.progressBar.hidden = false;
    bar.style.width = '0%';
    bar.classList.add('waiting');
  }
  hideProgress() {
    if (!this.progressBar) return;
    const bar = this.progressBar.querySelector('.progress-bar');
    bar.classList.remove('waiting');
    this.progressBar.hidden = true;
  }

  /* 4 · Result helpers */
  resetResult() {
    if (!this.resultCard) return;
    this.resultCard.hidden = true;
    this.resultCard.dataset.kind = '';
    this.resultCard.querySelectorAll('[data-result]').forEach(el => {
      if (el.tagName === 'A') {
        el.style.display = 'none';
        el.removeAttribute('href');
        el.removeAttribute('download');
      } else {
        el.textContent = '';
        el.innerHTML   = '';
      }
    });
  }

  showError(msg = 'Something went wrong') {
    this.hideProgress();
    if (!this.resultCard) return;
    this.resultCard.dataset.kind = 'error';
    this.resultCard.querySelector('[data-result="headline"]').textContent = 'Error';
    this.resultCard.querySelector('[data-result="text"]').textContent     = msg;
    this.resultCard.hidden = false;
  }

  displayResult(res) {
    this.hideProgress();
    if (!this.resultCard) return;

    const rc = this.resultCard;
    rc.dataset.kind = res.kind || 'success';

    rc.querySelector('[data-result="headline"]').textContent = res.headline || 'Done!';
    rc.querySelector('[data-result="text"]').textContent     = res.text     || '';

    /* 4.1 Single download */
    if (res.downloadUrl) {
      const link = rc.querySelector('[data-result="link"]');
      link.href        = res.downloadUrl;
      link.textContent = res.fileName ? `Download ${res.fileName}` : 'Download';
      if (res.fileName) link.setAttribute('download', res.fileName);
      link.style.display = 'inline-block';
    }

    /* 4.2 Multiple downloads */
    if (Array.isArray(res.downloadUrls)) {
      const wrap = rc.querySelector('[data-result="links"]');
      wrap.innerHTML = '';
      res.downloadUrls.forEach((url, i) => {
        const a = document.createElement('a');
        a.href        = url;
        a.textContent = res.fileNames?.[i] || `File ${i + 1}`;
        if (res.fileNames?.[i]) a.setAttribute('download', res.fileNames[i]);
        a.className   = 'result-link button';
        wrap.appendChild(a);
      });
    }

    /* 4.3 Extra HTML */
    if (res.extraHtml) {
      rc.querySelector('[data-result="extraHtml"]').innerHTML = res.extraHtml;
    }

    rc.hidden = false;
  }
}

/* 5 · Auto‑boot every WidgetShell on DOM ready */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-widget]').forEach(el => new WidgetShell(el));
});

export default WidgetShell;
