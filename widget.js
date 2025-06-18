/* ---------------------------------------------
   widget.js — Widget Factory Core
   Handles file uploads, job monitoring, and result display
   --------------------------------------------- */

// Version identifier
const WIDGET_VERSION = '2.5.9-filename-matching';
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
    const fileData = []; // Store file info with checksums
    
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
        
        // Store file data without checksum calculation
        fileData.push({
          key: key,
          fileName: file.name,
          uploadTime: Date.now()
        });
        
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
        const jobId = await this.getJobId(fileData); // Pass fileData instead of fileKeys
        if (jobId) {
          console.log(`📋 Starting job monitoring for: ${jobId}`);
          this.monitorJobProgress(jobId);
        } else {
          console.warn('No job ID found, processing may still be in progress');
          // Fallback: try again in a few seconds
          setTimeout(async () => {
            const retryJobId = await this.getJobId(fileData); // Pass fileData instead of fileKeys
            if (retryJobId) {
              this.monitorJobProgress(retryJobId);
            } else {
              // Only show error if no result is already displayed
              if (this.resultCard.hidden || !this.resultCard.querySelector('[data-result="link"]')?.href) {
                this.showError('Processing timeout - please try again');
              } else {
                console.log('Result already displayed via webhook, skipping error');
              }
            }
          }, 3000);
        }
      } catch (error) {
        console.error('Error getting job ID:', error);
        // Don't show error immediately - the webhook might still return results
        console.warn('Job monitoring failed, but processing may still complete via webhook');
      }
    }, 2000); // Wait 2 seconds for storage trigger
  }

  /* Get job ID using time and file name matching */
  async getJobId(fileData) {
    try {
      console.log(`🔍 Finding job using time + filename matching...`);
      
      const response = await fetch(
        `${this.SUPABASE_URL}/rest/v1/widget_jobs?user_id=eq.${this.anonId}&widget_id=eq.${this.widgetSlug}&order=created_at.desc&limit=10`, 
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
      console.log(`Found ${jobs.length} recent jobs:`, jobs);
      
      if (jobs.length === 0) {
        console.log('❌ No jobs found');
        return null;
      }
      
      // For single file uploads, find the most recent job that matches our file
      if (fileData.length === 1) {
        const uploadedFile = fileData[0];
        const uploadTime = uploadedFile.uploadTime;
        
        console.log('Looking for job matching:', {
          fileName: uploadedFile.fileName,
          uploadTime: new Date(uploadTime).toISOString(),
          fileKey: uploadedFile.key
        });
        
        // Find job created within 60 seconds of upload with matching file
        const cutoff = uploadTime - 60000; // 60 seconds before upload
        
        for (const job of jobs) {
          const jobTime = new Date(job.created_at).getTime();
          
          console.log(`Checking job ${job.id}:`, {
            created_at: job.created_at,
            file_keys: job.file_keys,
            status: job.status,
            age_from_upload: uploadTime - jobTime
          });
          
          // Check if job was created around the same time
          if (jobTime > cutoff) {
            // Check if file names/keys match
            if (job.file_keys && Array.isArray(job.file_keys)) {
              for (const jobFileKey of job.file_keys) {
                // Extract base filename from both keys
                const jobFileName = jobFileKey.split('/').pop();
                const uploadFileName = uploadedFile.key.split('/').pop();
                
                console.log(`Comparing filenames: "${jobFileName}" vs "${uploadFileName}"`);
                
                // Check if the core filename matches (ignoring timestamp prefixes)
                const jobBaseName = jobFileName.replace(/^\d+_/, '');
                const uploadBaseName = uploadFileName.replace(/^\d+_/, '');
                
                if (jobBaseName === uploadBaseName || jobFileName === uploadFileName) {
                  console.log(`✅ Found matching job: ${job.id} (filename match)`);
                  return job.id;
                }
              }
            }
          }
        }
        
        // If no filename match, use the most recent job
        const mostRecent = jobs[0];
        const timeDiff = uploadTime - new Date(mostRecent.created_at).getTime();
        
        if (timeDiff < 60000 && timeDiff > -10000) { // Within 60 seconds, not too far in the future
          console.log(`✅ Using most recent job as fallback: ${mostRecent.id} (${timeDiff}ms difference)`);
          return mostRecent.id;
        }
      }
      
      console.log('❌ No matching job found');
      return null;
      
    } catch (error) {
      console.error('Error finding job:', error);
      return null;
    }
  }


  /* Polling-based job monitoring */
  async monitorJobProgress(jobId) {
    let pollCount = 0;
    const maxPolls = 150; // 5 minutes at 2-second intervals
    
    const pollInterval = setInterval(async () => {
      pollCount++;
      
      // Check if result is already displayed (e.g., via direct webhook response)
      if (!this.resultCard.hidden && this.resultCard.querySelector('[data-result="link"]')?.href) {
        console.log('Result already displayed, stopping job monitoring');
        clearInterval(pollInterval);
        return;
      }
      
      try {
        let job = null;
        let response;
        
        // Query widget_jobs table
        response = await fetch(`${this.SUPABASE_URL}/rest/v1/widget_jobs?id=eq.${jobId}&select=*`, {
          headers: {
            'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`,
            'apikey': this.SUPABASE_ANON_KEY
          }
        });
        
        if (response.ok) {
          const jobs = await response.json();
          job = jobs[0];
        } else {
          console.error('Failed to fetch job:', response.status);
        }
        
        if (!job) {
          clearInterval(pollInterval);
          // Only show error if no result is already displayed
          if (this.resultCard.hidden || !this.resultCard.querySelector('[data-result="link"]')?.href) {
            this.showError('Job not found');
          }
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
          // Only show error if no result is already displayed
          if (this.resultCard.hidden || !this.resultCard.querySelector('[data-result="link"]')?.href) {
            this.showError('Monitoring failed - please refresh and try again');
          }
        }
      }
      
      // Stop polling after max attempts
      if (pollCount >= maxPolls) {
        clearInterval(pollInterval);
        // Only show error if no result is already displayed
        if (this.resultCard.hidden || !this.resultCard.querySelector('[data-result="link"]')?.href) {
          this.showError('Processing timeout - please refresh and try again');
        }
      }
    }, 2000); // Poll every 2 seconds
  }

  /* Enhanced parseJobResult method with detailed debugging */
  parseJobResult(resultData) {
    console.log('🔍 [DEBUG] parseJobResult called with:', {
      type: typeof resultData,
      value: resultData,
      hasKind: resultData?.kind,
      isString: typeof resultData === 'string',
      isObject: typeof resultData === 'object'
    });

    try {
      // Handle null/undefined
      if (!resultData) {
        console.log('❌ [DEBUG] resultData is null/undefined');
        return null;
      }

      // Handle string (JSON) - this is likely the issue
      if (typeof resultData === 'string') {
        console.log('🔧 [DEBUG] resultData is string, attempting to parse JSON');
        try {
          const parsed = JSON.parse(resultData);
          console.log('✅ [DEBUG] Successfully parsed JSON:', parsed);
          
          // Check if parsed object has the expected structure
          if (parsed && typeof parsed === 'object' && parsed.kind) {
            console.log('✅ [DEBUG] Parsed object has kind property:', parsed.kind);
            return parsed;
          }
          
          // Update resultData for further processing
          resultData = parsed;
        } catch (parseError) {
          console.error('❌ [DEBUG] Failed to parse JSON string:', parseError);
          return null;
        }
      }

      // Handle object with kind property (direct result)
      if (resultData && typeof resultData === 'object' && resultData.kind) {
        console.log('✅ [DEBUG] Result data is already in correct format with kind:', resultData.kind);
        return resultData;
      }

      // Handle webhook response format: { "job_id": { status: "completed", result_data: {...} } }
      if (resultData && typeof resultData === 'object') {
        console.log('🔧 [DEBUG] Checking for webhook response format...');
        const jobKeys = Object.keys(resultData);
        console.log('🔍 [DEBUG] Object keys:', jobKeys);
        
        if (jobKeys.length > 0) {
          const jobData = resultData[jobKeys[0]];
          console.log('🔍 [DEBUG] Job data for key', jobKeys[0], ':', jobData);
          
          if (jobData && jobData.result_data) {
            console.log('✅ [DEBUG] Found result_data in webhook format');
            
            // Handle nested JSON string
            let extractedResult = jobData.result_data;
            if (typeof extractedResult === 'string') {
              try {
                extractedResult = JSON.parse(extractedResult);
                console.log('✅ [DEBUG] Parsed nested result_data:', extractedResult);
              } catch (e) {
                console.error('❌ [DEBUG] Failed to parse nested result_data:', e);
              }
            }
            
            return extractedResult;
          }
        }
      }

      console.error('❌ [DEBUG] Unable to parse result data - no valid format found');
      console.error('❌ [DEBUG] Final resultData state:', resultData);
      return null;

    } catch (error) {
      console.error('❌ [DEBUG] Exception in parseJobResult:', error);
      console.error('❌ [DEBUG] Stack trace:', error.stack);
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

  /* 🔧 FIXED: Display result - Updated to match code embed structure */
  displayResult(result) {
    if (!this.resultCard) return;
    
    console.log('🔍 DEBUG: displayResult called with:', result);
    
    this.resultCard.dataset.kind = result.kind || 'success';
    this.resultCard.hidden = false;
    
    // Hide the file input dropzone when showing results
    if (this.fileInput) {
      this.fileInput.style.display = 'none';
    }
    
    // 🔧 FIXED: Use lowercase "headline" to match code embed
    const headlineEl = this.resultCard.querySelector('[data-result="headline"]');
    if (headlineEl) headlineEl.textContent = result.headline || 'Processing Complete!';
    
    // Set text (this matches)
    const textEl = this.resultCard.querySelector('[data-result="text"]');
    if (textEl) textEl.textContent = result.text || '';
    
    // 🔍 DEBUG: Check download URL handling
    console.log('🔍 Download URL check:', {
      hasDownloadUrl: !!result.downloadUrl,
      downloadUrl: result.downloadUrl,
      fileName: result.fileName
    });
    
    // 🔧 FIXED: Handle single download link using "link" instead of "single-link"
    if (result.downloadUrl) {
      let downloadLink = this.resultCard.querySelector('[data-result="link"]');
      
      console.log('🔍 Download link element found:', !!downloadLink);
      
      if (downloadLink) {
        downloadLink.href = result.downloadUrl;
        downloadLink.download = result.fileName || 'compressed.pdf';
        downloadLink.textContent = `📄 ${result.fileName || 'Download Compressed PDF'}`;
        downloadLink.style.display = 'inline-block'; // Show the link
        
        // 🎨 STYLE AS BUTTON
        downloadLink.style.cssText = `
          display: inline-block !important;
          background: #4F46E5;
          color: white;
          padding: 14px 28px;
          border-radius: 8px;
          text-decoration: none;
          font-weight: 600;
          font-size: 16px;
          text-align: center;
          cursor: pointer;
          border: none;
          transition: all 0.2s ease;
          margin-top: 20px;
          margin-bottom: 10px;
          box-shadow: 0 2px 8px rgba(79, 70, 229, 0.3);
        `;
        
        // Clear any existing event listeners and add new ones
        downloadLink.onmouseenter = () => {
          downloadLink.style.background = '#4338CA';
          downloadLink.style.transform = 'translateY(-1px)';
          downloadLink.style.boxShadow = '0 4px 12px rgba(79, 70, 229, 0.4)';
        };
        
        downloadLink.onmouseleave = () => {
          downloadLink.style.background = '#4F46E5';
          downloadLink.style.transform = 'translateY(0)';
          downloadLink.style.boxShadow = '0 2px 8px rgba(79, 70, 229, 0.3)';
        };
        
        console.log('✅ Download button configured and visible');
      } else {
        console.log('❌ Download link element not found - check code embed structure');
      }
    }
    
    // 🔧 FIXED: Handle multiple downloads using "links" instead of "link-list"
    if (result.downloadUrls && result.downloadUrls.length > 0) {
      const downloadContainer = this.resultCard.querySelector('[data-result="links"]');
      if (downloadContainer) {
        downloadContainer.innerHTML = '';
        result.downloadUrls.forEach((url, index) => {
          const link = document.createElement('a');
          link.href = url;
          link.download = result.fileNames?.[index] || `file_${index + 1}`;
          link.textContent = result.fileNames?.[index] || `Download File ${index + 1}`;
          link.className = 'download-link';
          
          // 🎨 STYLE AS BUTTON (consistent with single download)
          link.style.cssText = `
            display: inline-block;
            background: #4F46E5;
            color: white;
            padding: 10px 20px;
            border-radius: 6px;
            text-decoration: none;
            font-weight: 600;
            font-size: 13px;
            text-align: center;
            cursor: pointer;
            border: none;
            transition: all 0.2s ease;
            margin-top: 8px;
            margin-right: 8px;
          `;
          
          // Add hover effects
          link.addEventListener('mouseenter', () => {
            link.style.background = '#4338CA';
            link.style.transform = 'translateY(-1px)';
          });
          
          link.addEventListener('mouseleave', () => {
            link.style.background = '#4F46E5';
            link.style.transform = 'translateY(0)';
          });
          
          downloadContainer.appendChild(link);
        });
      }
    }
    
    // 🔧 FIXED: Add metadata using "extraHtml" instead of "metadata"
    if (result.metadata) {
      const extraHtmlEl = this.resultCard.querySelector('[data-result="extraHtml"]');
      if (extraHtmlEl) {
        let metadataHtml = '<div class="metadata-display">';
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
    
    // Hide the file input dropzone when showing upload success
    if (this.fileInput) {
      this.fileInput.style.display = 'none';
    }
    
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
    
    // Show the file input dropzone again when resetting
    if (this.fileInput) {
      this.fileInput.style.display = '';
    }
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
    
    // Hide the file input dropzone when showing error
    if (this.fileInput) {
      this.fileInput.style.display = 'none';
    }
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