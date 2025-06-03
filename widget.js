/* ---------------------------------------------
   widget.js — Widget Factory Master Controller
   Naming aligned with widgets.css & Webflow DOM
   --------------------------------------------- */

// Version identifier
const WIDGET_VERSION = '2.0.5-85de8a04';
window.WIDGET_FACTORY_VERSION = WIDGET_VERSION;
console.log(`🚀 Widget Factory v${WIDGET_VERSION} loading...`);
console.log(`📌 Version: ${WIDGET_VERSION}`);

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
    console.log('👤 Anonymous User ID:', this.getAnonId());
    
    try {
      // Default Supabase endpoints - update these with your project URL
      const SUPABASE_URL = 'https://yailbankhodrzsdmxxda.supabase.co';
      const N8N_WEBHOOK_URL = 'https://n8n.template-hub.com/webhook/process'; // Update with your n8n URL
      
      console.log('Setting endpoints...');
      this.presignEndpoint = rootEl.dataset.presignEndpoint || 
                            opts.presignEndpoint || 
                            `${SUPABASE_URL}/functions/v1/presign`;
      this.processEndpoint = rootEl.dataset.processEndpoint || 
                            opts.processEndpoint || 
                            N8N_WEBHOOK_URL;
      console.log('Endpoints set:', { presignEndpoint: this.presignEndpoint, processEndpoint: this.processEndpoint });

      /* ─ Child components (data-component) ─ */
      console.log('Finding child components...');
      this.fileInput   = rootEl.querySelector('[data-component="FileInput"]');
      this.progressBar = rootEl.querySelector('[data-component="ProgressBar"]');
      this.resultCard  = rootEl.querySelector('[data-component="ResultCard"]');
    } catch (e) {
      console.error('Error during initialization:', e);
      throw e;
    }

    console.log('Widget components found:', {
      fileInput: !!this.fileInput,
      progressBar: !!this.progressBar,
      resultCard: !!this.resultCard
    });

    /* ─ Wire listeners & anon‑ID ─ */
    this.initFileInput();
    this.anonId = this.getAnonId();
    console.log('👤 Initialized User ID:', this.anonId);
    
    // Check and display user credits
    this.checkUserCredits();
  }

 /* 1.1 FileInput → drag-drop & picker */
initFileInput() {
  if (!this.fileInput) return;

  const dropzone = this.fileInput.querySelector('.dropzone');
  if (!dropzone) return;

  /* ① Caption → “Drag Files Here” */
  let label = dropzone.querySelector('.u-drop-label');
  if (!label) {
    // Create label if it doesn't exist
    label = document.createElement('div');
    label.className = 'u-drop-label';
    label.textContent = 'Drag your file(s) here!';
    label.style.cssText = 'pointer-events: none; user-select: none;';
    dropzone.appendChild(label);
  } else {
    label.textContent = 'Drag your file(s) here!';
  }

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
    try {
      let id = localStorage.getItem('wf_anon_id');
      if (!id) {
        id = 'anon_' + Math.random().toString(36).slice(2, 11);
        localStorage.setItem('wf_anon_id', id);
      }
      console.log('👤 Retrieved User ID from localStorage:', id);
      return id;
    } catch (e) {
      console.error('localStorage error:', e);
      // Fallback if localStorage is not available
      return 'anon_' + Math.random().toString(36).slice(2, 11);
    }
  }

  /* 1.3 Check user credits */
  async checkUserCredits() {
    try {
      const SUPABASE_URL = 'https://yailbankhodrzsdmxxda.supabase.co';
      const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhaWxiYW5raG9kcnpzZG14eGRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY3NDYzMTYsImV4cCI6MjA2MjMyMjMxNn0.v_-5Xzs6lLU1L1UunDu4LAJj8yFlRID9mN65iGk0fig';
      
      const response = await fetch(`${SUPABASE_URL}/rest/v1/user_credits?user_id=eq.${this.anonId}&select=balance`, {
        headers: {
          'Authorization': `Bearer ${ANON_KEY}`,
          'apikey': ANON_KEY
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data && data[0]) {
          console.log(`💳 User Credits: ${data[0].balance} (User: ${this.anonId})`);
          return data[0].balance;
        } else {
          console.log(`💳 User Credits: 0 (User not found: ${this.anonId})`);
          return 0;
        }
      }
    } catch (error) {
      console.error('Error checking credits:', error);
    }
    return null;
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
        
        // Ensure anonId is set
        if (!this.anonId) {
          console.error('anonId is not set, regenerating...');
          this.anonId = this.getAnonId();
        }
        
        const requestBody = {
          anon_id: this.anonId,
          widget_id: this.widgetSlug,
          mime:    file.type,
          size:    file.size
        };
        console.log('Request body:', JSON.stringify(requestBody));
        console.log('anonId value:', this.anonId);
        console.log('widgetSlug value:', this.widgetSlug);
        
        if (!requestBody.anon_id || !requestBody.widget_id) {
          console.error('Critical: Missing required fields before request', requestBody);
          throw new Error('Missing required fields: anon_id or widget_id');
        }
        
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

// Auto-initialization
function initializeWidgets() {
  console.log('Looking for widgets to initialize...');
  const widgets = document.querySelectorAll('[data-widget], [data-widget-id]');
  console.log(`Found ${widgets.length} widget(s) to initialize`);
  
  widgets.forEach((el, index) => {
    try {
      const widgetId = el.dataset.widget || el.dataset.widgetId;
      console.log(`Initializing widget ${index + 1}/${widgets.length}: ${widgetId}`);
      new WidgetShell(el);
      console.log(`✅ Widget initialized: ${widgetId}`);
    } catch (err) {
      console.error('❌ Widget init failed:', err);
    }
  });

  // Broadcast a ready event
  window.dispatchEvent(new CustomEvent('widgetfactory:ready', {
    detail: { widgetCount: widgets.length }
  }));
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeWidgets);
} else {
  initializeWidgets();
}

// Also expose for manual init
window.WidgetShell = WidgetShell;

// Global function to check credits
window.checkMyCredits = async function() {
  const anonId = localStorage.getItem('wf_anon_id');
  if (!anonId) {
    console.log('No user ID found. Upload a file first to create one.');
    return;
  }
  
  const SUPABASE_URL = 'https://yailbankhodrzsdmxxda.supabase.co';
  const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhaWxiYW5raG9kcnpzZG14eGRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY3NDYzMTYsImV4cCI6MjA2MjMyMjMxNn0.v_-5Xzs6lLU1L1UunDu4LAJj8yFlRID9mN65iGk0fig';
  
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/user_credits?user_id=eq.${anonId}&select=balance`, {
      headers: {
        'Authorization': `Bearer ${ANON_KEY}`,
        'apikey': ANON_KEY
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      if (data && data[0]) {
        console.log(`💳 Credit Balance: ${data[0].balance}`);
        console.log(`👤 User ID: ${anonId}`);
        console.log(`📌 Widget Version: ${window.WIDGET_FACTORY_VERSION || 'Unknown'}`);
        return data[0].balance;
      } else {
        console.log(`💳 No credits found for user: ${anonId}`);
        console.log(`📌 Widget Version: ${window.WIDGET_FACTORY_VERSION || 'Unknown'}`);
        return 0;
      }
    }
  } catch (error) {
    console.error('Error checking credits:', error);
  }
};

// Startup summary
setTimeout(() => {
  const anonId = localStorage.getItem('wf_anon_id');
  console.log('=== Widget Factory Ready ===');
  console.log(`📌 Version: ${WIDGET_VERSION}`);
  console.log(`👤 Your User ID: ${anonId || 'Not set yet'}`);
  console.log('💡 Run checkMyCredits() to see your balance');
  console.log('===========================');
}, 100);

export default WidgetShell;
