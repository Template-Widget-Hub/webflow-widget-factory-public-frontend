/* ---------------------------------------------
   widget.js — Widget Factory Core
   Handles file uploads, job monitoring, and result display
   --------------------------------------------- */

// Version identifier
const WIDGET_VERSION = '2.2.0-51282652';
window.WIDGET_FACTORY_VERSION = WIDGET_VERSION;
console.log(`🚀 Widget Factory v${WIDGET_VERSION} loading...`);

/* Runtime guard */
if (window.WidgetFactoryLoaded) {
  console.warn('Widget Factory already loaded — skipping init');
} else {
  window.WidgetFactoryLoaded = true;
}

/* WidgetShell - Main widget controller class */
class WidgetShell {
  constructor(rootEl, opts = {}) {
    /* ─ Dataset hooks ─ */
    this.rootEl          = rootEl;
    this.widgetSlug      = rootEl.dataset.widget || rootEl.dataset.widgetId || '';
    
    if (!this.widgetSlug) {
      console.error('Widget Error: No data-widget or data-widget-id attribute found');
      return;
    }
    
    console.log('Initializing widget:', this.widgetSlug);
    
    // Supabase configuration
    const SUPABASE_URL = 'https://yailbankhodrzsdmxxda.supabase.co';
    this.SUPABASE_URL = SUPABASE_URL;
    this.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhaWxiYW5raG9kcnpzZG14eGRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY3NDYzMTYsImV4cCI6MjA2MjMyMjMxNn0.v_-5Xzs6lLU1L1UunDu4LAJj8yFlRID9mN65iGk0fig';
    
    this.presignEndpoint = rootEl.dataset.presignEndpoint || 
                          opts.presignEndpoint || 
                          `${SUPABASE_URL}/functions/v1/presign`;
    
    /* ─ Child components ─ */
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
    console.log('👤 User ID:', this.anonId);
    
    // Check user credits
    this.checkUserCredits();
  }

  /* Enhanced handleFiles with job monitoring */
  async handleFiles(files) {
    if (!files || !files.length) return;

    this.resetResult();
    this.showProgress();

    const fileKeys = [];
    
    /* Upload all files first */
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
          mime: file.type,
          size: file.size,
          fileName: file.name
        };
        
        console.log('Request body:', JSON.stringify(requestBody));
        
        const pre = await fetch(this.presignEndpoint, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`
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
          body: file
        });
        if (!up.ok) throw new Error('Upload failed');
        fileKeys.push(key);
        
      } catch (err) {
        console.error(err);
        return this.showError(err.message);
      }
    }

    /* 2.3 Show upload success and start monitoring */
    this.showUploadSuccess(fileKeys);
    
    // Wait a moment for the storage trigger to create the job
    setTimeout(async () => {
      try {
        const jobId = await this.getJobId(fileKeys);
        if (jobId) {
          console.log(`📋 Starting job monitoring for: ${jobId}`);
          this.monitorJobProgress(jobId);
        } else {
          console.warn('No job ID found, processing may still be in progress');
          // Fallback: try again in a few seconds
          setTimeout(async () => {
            const retryJobId = await this.getJobId(fileKeys);
            if (retryJobId) {
              this.monitorJobProgress(retryJobId);
            } else {
              this.showError('Job not found - please try again');
            }
          }, 3000);
        }
      } catch (error) {
        console.error('Error getting job ID:', error);
        this.showError('Failed to start monitoring - please refresh and try again');
      }
    }, 1500); // Wait 1.5 seconds for storage trigger
  }

  /* Method to get job ID from database based on uploaded files */
  async getJobId(fileKeys) {
    try {
      // Query for recent jobs by this user and widget
      const response = await fetch(
        `${this.SUPABASE_URL}/rest/v1/widget_jobs?user_id=eq.${this.anonId}&widget_id=eq.${this.widgetSlug}&order=created_at.desc&limit=3`, 
        {
          headers: {
            'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`,
            'apikey': this.SUPABASE_ANON_KEY
          }
        }
      );
      
      if (!response.ok) {
        console.error('Failed to query jobs:', response.status, response.statusText);
        return null;
      }
      
      const jobs = await response.json();
      console.log('Found jobs:', jobs);
      
      if (!jobs || jobs.length === 0) {
        console.log('No jobs found yet');
        return null;
      }
      
      // Find job that matches our file keys
      for (const job of jobs) {
        if (this.jobMatchesFiles(job, fileKeys)) {
          console.log('Found matching job:', job.id);
          return job.id;
        }
      }
      
      // If no exact match, return the most recent job
      // (this handles cases where file_keys format might differ slightly)
      console.log('No exact match found, using most recent job:', jobs[0].id);
      return jobs[0].id;
      
    } catch (error) {
      console.error('Error fetching job ID:', error);
      return null;
    }
  }

  /* Helper method to check if a job matches our uploaded files */
  jobMatchesFiles(job, fileKeys) {
    try {
      let jobFileKeys = job.file_keys;
      
      // Handle case where file_keys is stored as JSON string
      if (typeof jobFileKeys === 'string') {
        jobFileKeys = JSON.parse(jobFileKeys);
      }
      
      if (!Array.isArray(jobFileKeys)) {
        console.log('Job file_keys is not an array:', jobFileKeys);
        return false;
      }
      
      // Check if any of our file keys match the job's file keys
      for (const fileKey of fileKeys) {
        if (jobFileKeys.some(jobKey => jobKey.includes(fileKey) || fileKey.includes(jobKey))) {
          return true;
        }
      }
      
      return false;
      
    } catch (error) {
      console.error('Error checking job file match:', error);
      return false;
    }
  }

  /* Polling-based job monitoring */
  async monitorJobProgress(jobId) {
    let pollCount = 0;
    const maxPolls = 150; // 5 minutes at 2-second intervals
    
    const pollInterval = setInterval(async () => {
      pollCount++;
      
      try {
        const response = await fetch(`${this.SUPABASE_URL}/rest/v1/widget_jobs?id=eq.${jobId}&select=*`, {
          headers: {
            'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`,
            'apikey': this.SUPABASE_ANON_KEY
          }
        });
        
        if (!response.ok) {
          console.error('Polling failed:', response.status);
          return;
        }
        
        const jobs = await response.json();
        const job = jobs[0];
        
        if (!job) {
          clearInterval(pollInterval);
          this.showError('Job not found');
          return;
        }
        
        console.log(`📊 Job ${jobId} status: ${job.status} (poll ${pollCount})`);
        
        if (job.status === 'completed') {
          clearInterval(pollInterval);
          
          // Parse the webhook response format
          const result = this.parseJobResult(job.result_data);
          if (result) {
            this.handleJobCompleted(result);
          } else {
            this.showError('Invalid response format');
          }
          
        } else if (job.status === 'error') {
          clearInterval(pollInterval);
          this.showError(job.error_message || 'Processing failed');
          
        } else if (job.status === 'in_progress') {
          this.updateProgressText('Processing your files...');
          
        } else if (job.status === 'pending') {
          this.updateProgressText('Queued for processing...');
        }
        
      } catch (error) {
        console.error('Polling error:', error);
        if (pollCount > 10) { // Only fail after multiple retries
          clearInterval(pollInterval);
          this.showError('Monitoring failed - please refresh and try again');
        }
      }
      
      // Stop polling after max attempts
      if (pollCount >= maxPolls) {
        clearInterval(pollInterval);
        this.showError('Processing timeout - please refresh and try again');
      }
    }, 2000); // Poll every 2 seconds
  }

  /* Parse job result data (handles webhook response format) */
  parseJobResult(resultData) {
    try {
      // If result_data is already an object with the expected structure
      if (resultData && typeof resultData === 'object' && resultData.kind) {
        console.log('Result data is already in correct format');
        return resultData;
      }
      
      // Handle if resultData is a string (JSON)
      let parsed = resultData;
      if (typeof resultData === 'string') {
        parsed = JSON.parse(resultData);
      }
      
      // Handle webhook response format: { "job_id": { status: "completed", result_data: {...} } }
      if (parsed && typeof parsed === 'object') {
        // Get the first key (job ID)
        const jobKeys = Object.keys(parsed);
        if (jobKeys.length > 0) {
          const jobData = parsed[jobKeys[0]];
          if (jobData && jobData.result_data) {
            console.log('Extracted result_data from webhook format');
            return jobData.result_data;
          }
        }
      }
      
      console.error('Unable to parse result data:', resultData);
      return null;
      
    } catch (error) {
      console.error('Error parsing job result:', error);
      return null;
    }
  }

  /* Handle completed job results */
  handleJobCompleted(resultData) {
    this.hideProgress();
    
    if (!resultData) {
      this.showError('No result data received');
      return;
    }
    
    console.log('🎉 Processing completed with result:', resultData);
    
    // Use existing displayResult method
    this.displayResult(resultData);
  }

  /* Display result - matches your existing implementation */
  displayResult(result) {
    if (!this.resultCard) return;
    
    this.resultCard.dataset.kind = result.kind || 'success';
    this.resultCard.hidden = false;
    
    // Set headline
    const headlineEl = this.resultCard.querySelector('[data-result="headline"]');
    if (headlineEl) headlineEl.textContent = result.headline || 'Processing Complete!';
    
    // Set text
    const textEl = this.resultCard.querySelector('[data-result="text"]');
    if (textEl) textEl.textContent = result.text || '';
    
    // Handle download links
    if (result.downloadUrl) {
      const downloadLink = this.resultCard.querySelector('[data-result="download-url"]');
      if (downloadLink) {
        downloadLink.href = result.downloadUrl;
        downloadLink.download = result.fileName || 'download';
        downloadLink.textContent = result.fileName || 'Download Result';
        downloadLink.style.display = 'inline-block';
      }
    }
    
    // Handle multiple downloads
    if (result.downloadUrls && result.downloadUrls.length > 0) {
      const downloadContainer = this.resultCard.querySelector('[data-result="downloads"]');
      if (downloadContainer) {
        downloadContainer.innerHTML = '';
        result.downloadUrls.forEach((url, index) => {
          const link = document.createElement('a');
          link.href = url;
          link.download = result.fileNames?.[index] || `file_${index + 1}`;
          link.textContent = result.fileNames?.[index] || `Download File ${index + 1}`;
          link.className = 'download-link';
          link.style.display = 'block';
          link.style.marginTop = '5px';
          downloadContainer.appendChild(link);
        });
      }
    }
    
    // Add metadata display if present
    if (result.metadata) {
      const metadataEl = this.resultCard.querySelector('[data-result="metadata"]');
      if (metadataEl) {
        let metadataHtml = '';
        if (result.metadata.compressedSize) {
          metadataHtml += `<p>💾 Size: ${this.formatFileSize(result.metadata.compressedSize)}</p>`;
        }
        if (result.metadata.compressionLevel) {
          metadataHtml += `<p>🔧 Level: ${result.metadata.compressionLevel}</p>`;
        }
        metadataEl.innerHTML = metadataHtml;
        metadataEl.style.display = metadataHtml ? 'block' : 'none';
      }
    }
  }

  /* === Original methods below (unchanged) === */

  initFileInput() {
    if (!this.fileInput) return;

    const dropzone = this.fileInput.querySelector('.dropzone');
    if (!dropzone) return;

    /* Caption */
    let label = dropzone.querySelector('.u-drop-label');
    if (!label) {
      label = document.createElement('div');
      label.className = 'u-drop-label';
      label.textContent = 'Drag your file(s) here!';
      label.style.cssText = 'pointer-events: none; user-select: none;';
      dropzone.appendChild(label);
    } else {
      label.textContent = 'Drag your file(s) here!';
    }

    /* Create invisible input */
    let input = this.fileInput.querySelector('input[type="file"]');
    if (!input) {
      input = document.createElement('input');
      input.type      = 'file';
      input.multiple  = true;
      dropzone.appendChild(input);
    }
    input.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      opacity: 0; cursor: pointer; z-index: 2;
    `;

    /* Events */
    dropzone.addEventListener('click', () => input.click());
    input.addEventListener('change', () => this.handleFiles(input.files));

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
      label.textContent = 'Drop your files!';
    });
    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
      label.textContent = 'Drag your file(s) here!';
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      label.textContent = 'Drag your file(s) here!';
      this.handleFiles(e.dataTransfer.files);
    });
  }

  showUploadSuccess(fileKeys) {
    this.hideProgress();
    if (!this.resultCard) return;
    
    this.resultCard.dataset.kind = 'processing';
    const headlineEl = this.resultCard.querySelector('[data-result="headline"]');
    if (headlineEl) headlineEl.textContent = 'Upload Complete';
    const textEl = this.resultCard.querySelector('[data-result="text"]');
    if (textEl) textEl.textContent = 'Starting processing...';
    this.resultCard.hidden = false;
    
    console.log(`✅ Files uploaded successfully:`, fileKeys);
    console.log(`🔄 Monitoring job progress...`);
  }

  updateProgressText(text) {
    if (this.resultCard) {
      const textEl = this.resultCard.querySelector('[data-result="text"]');
      if (textEl) textEl.textContent = text;
      
      // Show processing state
      this.resultCard.dataset.kind = 'processing';
      this.resultCard.hidden = false;
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
    bar.style.width = '100%';
    this.progressBar.hidden = true;
  }

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
    const headlineEl = this.resultCard.querySelector('[data-result="headline"]');
    if (headlineEl) headlineEl.textContent = 'Error';
    const textEl = this.resultCard.querySelector('[data-result="text"]');
    if (textEl) textEl.textContent = msg;
    this.resultCard.hidden = false;
  }

  getAnonId() {
    const LOCAL_KEY = 'wf_widget_anon_id';
    let id = localStorage.getItem(LOCAL_KEY);
    if (!id) {
      id = 'anon_' + Math.random().toString(36).slice(2, 11);
      localStorage.setItem(LOCAL_KEY, id);
    }
    return id;
  }

  async checkUserCredits() {
    try {
      const res = await fetch(
        `${this.SUPABASE_URL}/rest/v1/user_credits?user_id=eq.${this.anonId}&select=balance`,
        {
          headers: {
            'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`,
            'apikey': this.SUPABASE_ANON_KEY
          }
        }
      );
      if (res.ok) {
        const data = await res.json();
        const credits = data[0]?.balance || 0;
        console.log(`💳 User credits: ${credits}`);
        this.userCredits = credits;
      }
    } catch (err) {
      console.error('Failed to check credits:', err);
    }
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

/* Auto-init on DOM ready */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAllWidgets);
} else {
  initAllWidgets();
}

function initAllWidgets() {
  const widgets = document.querySelectorAll('[data-widget], [data-widget-id]');
  widgets.forEach((el) => {
    const widget = new WidgetShell(el);
    // Store reference for cleanup if needed
    el._widgetInstance = widget;
  });
  console.log(`✅ Widget Factory initialized (${widgets.length} widgets)`);
  
  // Dispatch ready event for external scripts
  window.dispatchEvent(new CustomEvent('widgetfactory:ready', {
    detail: { widgetCount: widgets.length }
  }));
}

// Export for use in other scripts
window.WidgetShell = WidgetShell;