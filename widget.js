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
    this.widgetSlug      = rootEl.dataset.widget ||        // "merge-pdf" (preferred)
                          rootEl.dataset.widgetId ||       // fallback to data-widget-id
                          '';
    
    // Check if widget ID is set
    if (!this.widgetSlug) {
      console.error('Widget Error: No data-widget or data-widget-id attribute found on element:', rootEl);
      console.error('Add data-widget="mp3-to-text" or data-widget-id="mp3-to-text" to your widget element');
      return;
    }
    
    console.log('Initializing widget:', this.widgetSlug);
    
    // Default Supabase endpoints - update these with your project URL
    const SUPABASE_URL = 'https://yailbankhodrzsdmxxda.supabase.co';
    const N8N_WEBHOOK_URL = 'https://n8n.template-hub.com/webhook/process'; // Update with your n8n URL
    
    this.presignEndpoint = rootEl.dataset.presignEndpoint || 
                          opts.presignEndpoint || 
                          `${SUPABASE_URL}/functions/v1/presign`;
    this.processEndpoint = rootEl.dataset.processEndpoint || 
                          opts.processEndpoint || 
                          N8N_WEBHOOK_URL;

    /* ─ Child components (data-component) ─ */
    this.fileInput   = rootEl.querySelector('[data-component="FileInput"]');
    this.progressBar = rootEl.querySelector('[data-component="ProgressBar"]');
    this.resultCard  = rootEl.querySelector('[data-component="ResultCard"]');

    console.log('Widget components found:', {
      fileInput: !!this.fileInput,
      progressBar: !!this.progressBar,
      resultCard: !!this.resultCard
    });

    /* ─ Wire listeners & anon‑ID ─ */
    this.initFileInput();
    this.anonId = this.getAnonId();
  }

 /* 1.1 FileInput → drag-drop & picker */
initFileInput() {
  if (!this.fileInput) return;

  const dropzone = this.fileInput.querySelector('.dropzone');
  if (!dropzone) return;

  /* ① Caption → “Drag Files Here” */
  const label = dropzone.querySelector('.u-drop-label');
  if (label) label.textContent = 'Drag Files Here';

  /* ② Create or reuse invisible <input> overlay */
  let input = this.fileInput.querySelector('input[type="file"]');
  if (!input) {
    input = document.createElement('input');
    input.type      = 'file';
    input.multiple  = true;
    dropzone.appendChild(input);
  }
  Object.assign(input.style, {
    position:'absolute', inset:'0', width:'100%', height:'100%',
    opacity:'0', cursor:'pointer', zIndex:'2', pointerEvents:'auto'
  });
  dropzone.style.position ||= 'relative';

+ /* ③ Hide any fallback browser text (e.g. “No file chosen”) */
+ input.setAttribute('title', '');               // no tooltip
+ input.addEventListener('click', e => e.stopPropagation());

  /* ④ Drag-hover highlight */
  ['dragenter','dragover'].forEach(evt =>
    dropzone.addEventListener(evt, e => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    })
  );
  ['dragleave','drop'].forEach(evt =>
    dropzone.addEventListener(evt, () => dropzone.classList.remove('dragover'))
  );

  /* ⑤ Drop & picker handlers */
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    this.handleFiles(e.dataTransfer.files);
  });
  input.addEventListener('change', () => this.handleFiles(input.files));
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
        console.log('Presign endpoint:', this.presignEndpoint);
        console.log('Widget ID:', this.widgetSlug);
        console.log('File:', file.name, file.type, file.size);
        
        const requestBody = {
          anon_id: this.anonId,
          widget_id: this.widgetSlug,
          mime:    file.type,
          size:    file.size
        };
        console.log('Request body:', JSON.stringify(requestBody));
        
        const pre = await fetch(this.presignEndpoint, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhaWxiYW5raG9kcnpzZG14eGRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY3NDYzMTYsImV4cCI6MjA2MjMyMjMxNn0.v_-5Xzs6lLU1L1UunDu4LAJj8yFlRID9mN65iGk0fig'
          },
          body: JSON.stringify(requestBody)
        });
        
        if (!pre.ok) {
          const errorText = await pre.text();
          console.error('Presign response:', pre.status, errorText);
          throw new Error(`Presign failed: ${pre.status} ${errorText}`);
        }
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
          widget_id: this.widgetSlug,
          file_keys: fileKeys
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

showProgress() {
  if (!this.progressBar) return;
  const bar = this.progressBar.querySelector('.progress-fill, .progress-bar');
  if (!bar) return;
  this.progressBar.hidden = false;
  bar.style.width = '0%';
  bar.classList.add('waiting');
}
hideProgress() {
  if (!this.progressBar) return;
  const bar = this.progressBar.querySelector('.progress-fill, .progress-bar');
  if (!bar) return;
  bar.classList.remove('waiting');
  bar.style.width = '100%';          /* snap to full when done */
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

/* 6 · Core dropzone styles (injected if not already in CSS) */
const dropzoneStyles = `
  /* Core dropzone visuals (if not yet in widgets.css) */
  .dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 2rem;
    border: 2px dashed var(--wf-border, #ccc);
    border-radius: 8px;
    background: var(--wf-bg-light, rgba(0,0,0,.02));
    transition: border-color .2s, background .2s;
    cursor: pointer;
    user-select: none;
  }

  .dropzone.dragover {
    border-color: var(--wf-primary, #4285f4);
    background: rgba(66,133,244,.06);
  }

  /* Icon defaults */
  .dropzone .u-drop-icon {
    width: 48px;
    height: 48px;
    pointer-events: none;      /* clicks pass through */
  }

  /* Label */
  .dropzone .u-drop-label {
    margin: 0;
    font-size: 16px;
    color: #666;
    text-align: center;
    pointer-events: none;
  }

  /* Hide icon + label once a file is chosen */
  .dropzone.success .u-drop-icon,
  .dropzone.success .u-drop-label {
    display: none;
  }

  /* Limit any <img> or <svg> inside .dropzone */
  .dropzone img,
  .dropzone svg {
    width: 48px;
    height: 48px;
    margin: 0 auto 0.5rem;
    pointer-events: none;
  }

  /* Style any text block directly inside .dropzone */
  .dropzone > *:last-child {
    margin-top: 0.5rem;
    font-size: 16px;
    color: #666;
    text-align: center;
  }
`;

/* Inject styles if not already present */
if (!document.getElementById('widget-dropzone-styles')) {
  const styleEl = document.createElement('style');
  styleEl.id = 'widget-dropzone-styles';
  styleEl.textContent = dropzoneStyles;
  document.head.appendChild(styleEl);
}

export default WidgetShell;
