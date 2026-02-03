// LazyApply Frontend Application

const API_BASE = '/api';

// State
let jobs = [];
let selectedJobs = new Set();
let currentJob = null;
let profile = null;
let automationStatusPoll = null;

// DOM Elements
const elements = {
  jobsTableBody: document.getElementById('jobsTableBody'),
  jobCount: document.getElementById('jobCount'),
  selectedCount: document.getElementById('selectedCount'),
  applyCount: document.getElementById('applyCount'),
  applyBtn: document.getElementById('applyBtn'),
  emptyState: document.getElementById('emptyState'),
  pendingAlert: document.getElementById('pendingAlert'),
  pendingCount: document.getElementById('pendingCount'),
  selectAllCheckbox: document.getElementById('selectAllCheckbox'),
  filterStatus: document.getElementById('filterStatus'),
  loadingOverlay: document.getElementById('loadingOverlay'),
  loadingText: document.getElementById('loadingText'),
  toastContainer: document.getElementById('toastContainer'),
};

// Status icons
const statusIcons = {
  ready: '⚪',
  needs_input: '🟡',
  applying: '🔵',
  applied: '🟢',
  failed: '🔴',
  skipped: '⚫',
  login_required: '🔐',
};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadJobs();
  loadProfile();
});

// API Functions
async function apiCall(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'API request failed');
  }

  return data;
}

// Load jobs from server
async function loadJobs() {
  try {
    const response = await apiCall('/jobs');
    jobs = response.data || [];
    renderJobs();
  } catch (error) {
    console.error('Failed to load jobs:', error);
  }
}

// Load profile
async function loadProfile() {
  try {
    const response = await apiCall('/profile');
    profile = response.data;
  } catch (error) {
    console.error('Failed to load profile:', error);
  }
}

// Search Jobs
async function searchJobs() {
  const query = document.getElementById('searchQuery').value.trim();
  const location = document.getElementById('searchLocation').value.trim();
  const remoteOnly = document.getElementById('remoteOnly').checked;

  if (!query) {
    showToast('Please enter a job title to search', 'error');
    return;
  }

  showLoading('Searching for jobs...');

  try {
    const params = new URLSearchParams({
      query,
      location,
      remote: remoteOnly,
    });

    const response = await apiCall(`/search?${params}`);
    jobs = response.data || [];

    showToast(`Found ${jobs.length} jobs`, 'success');
    renderJobs();
  } catch (error) {
    showToast(`Search failed: ${error.message}`, 'error');
  } finally {
    hideLoading();
  }
}

// Render Jobs Table
function renderJobs() {
  const filter = elements.filterStatus.value;
  let filteredJobs = jobs;

  if (filter !== 'all') {
    filteredJobs = jobs.filter((job) => job.status === filter);
  }

  elements.jobCount.textContent = `${filteredJobs.length} jobs found`;

  if (filteredJobs.length === 0) {
    elements.jobsTableBody.innerHTML = '';
    elements.emptyState.style.display = 'block';
    return;
  }

  elements.emptyState.style.display = 'none';

  elements.jobsTableBody.innerHTML = filteredJobs
    .map(
      (job) => `
    <tr data-id="${job.id}">
      <td>
        <input
          type="checkbox"
          ${selectedJobs.has(job.id) ? 'checked' : ''}
          ${job.status === 'applied' || job.status === 'skipped' ? 'disabled' : ''}
          onchange="toggleJobSelection('${job.id}')"
        >
      </td>
      <td>
        <span class="status-badge status-${job.status}">
          ${statusIcons[job.status]} ${formatStatus(job.status)}
        </span>
      </td>
      <td>
        <strong>${escapeHtml(job.title)}</strong>
      </td>
      <td>${escapeHtml(job.company)}</td>
      <td>
        <span class="platform-badge platform-${job.platform}">
          ${job.platform}
        </span>
      </td>
      <td>
        <div class="action-buttons">
          <button class="action-btn action-btn-review" onclick="reviewJob('${job.id}')">
            Review
          </button>
          ${getActionButton(job)}
        </div>
      </td>
    </tr>
  `
    )
    .join('');

  updatePendingAlert();
  updateSelectionCount();
}

// Get action button based on job status
function getActionButton(job) {
  switch (job.status) {
    case 'ready':
      return `<button class="action-btn action-btn-apply" onclick="applyToSingleJob('${job.id}')">Apply</button>`;
    case 'needs_input':
      return `<button class="action-btn action-btn-fill" onclick="showInputModal('${job.id}')">Fill</button>`;
    case 'failed':
      return `<button class="action-btn action-btn-retry" onclick="retryJob('${job.id}')">Retry</button>`;
    case 'applied':
      return `<span style="color: var(--success)">✓ Applied</span>`;
    case 'applying':
      return `<span style="color: var(--info)">⏳ Applying...</span>`;
    default:
      return '';
  }
}

// Format status for display
function formatStatus(status) {
  const labels = {
    ready: 'Ready',
    needs_input: 'Input',
    applying: 'Applying',
    applied: 'Applied',
    failed: 'Failed',
    skipped: 'Skipped',
    login_required: 'Login',
  };
  return labels[status] || status;
}

// Toggle job selection
function toggleJobSelection(jobId) {
  if (selectedJobs.has(jobId)) {
    selectedJobs.delete(jobId);
  } else {
    selectedJobs.add(jobId);
  }
  updateSelectionCount();
}

// Update selection count
function updateSelectionCount() {
  const count = selectedJobs.size;
  elements.selectedCount.textContent = `${count} selected`;
  elements.applyCount.textContent = count;
  elements.applyBtn.disabled = count === 0;
}

// Select all jobs
function selectAll() {
  jobs
    .filter((job) => job.status === 'ready' || job.status === 'needs_input')
    .forEach((job) => selectedJobs.add(job.id));
  renderJobs();
}

// Clear selection
function clearSelection() {
  selectedJobs.clear();
  renderJobs();
}

// Toggle select all checkbox
function toggleSelectAll() {
  const checked = elements.selectAllCheckbox.checked;
  if (checked) {
    selectAll();
  } else {
    clearSelection();
  }
}

// Filter jobs
function filterJobs() {
  renderJobs();
}

// Update pending alert
function updatePendingAlert() {
  const pendingCount = jobs.filter((job) => job.status === 'needs_input').length;

  if (pendingCount > 0) {
    elements.pendingAlert.style.display = 'flex';
    elements.pendingCount.textContent = pendingCount;
  } else {
    elements.pendingAlert.style.display = 'none';
  }
}

// Review Job
function reviewJob(jobId) {
  currentJob = jobs.find((job) => job.id === jobId);
  if (!currentJob) return;

  document.getElementById('reviewTitle').textContent = `${currentJob.title} @ ${currentJob.company}`;

  document.getElementById('reviewBody').innerHTML = `
    <div class="job-details">
      <div class="job-detail-row">
        <div class="job-detail-item">
          <div class="job-detail-label">📍 Location</div>
          <div class="job-detail-value">${escapeHtml(currentJob.location)}</div>
        </div>
        <div class="job-detail-item">
          <div class="job-detail-label">💰 Salary</div>
          <div class="job-detail-value">${currentJob.salary || 'Not specified'}</div>
        </div>
      </div>
      <div class="job-detail-row">
        <div class="job-detail-item">
          <div class="job-detail-label">🔗 Platform</div>
          <div class="job-detail-value">
            <span class="platform-badge platform-${currentJob.platform}">${currentJob.platform}</span>
          </div>
        </div>
        <div class="job-detail-item">
          <div class="job-detail-label">📅 Posted</div>
          <div class="job-detail-value">${currentJob.postedDate || 'Recently'}</div>
        </div>
      </div>

      <div class="job-description">
        <h4>Job Description</h4>
        <p>${escapeHtml(currentJob.description)}</p>
      </div>

      <div class="job-detail-item" style="margin-top: 16px;">
        <div class="job-detail-label">🔗 Job URL</div>
        <div class="job-detail-value">
          <a href="${currentJob.url}" target="_blank" style="color: var(--primary);">${currentJob.url}</a>
        </div>
      </div>
    </div>
  `;

  showModal('reviewModal');
}

// Apply to single job
async function applyToSingleJob(jobId) {
  showLoading('Starting application...');

  try {
    const response = await apiCall(`/jobs/${jobId}/apply`, { method: 'POST' });
    console.log('Apply response:', response); // Debug logging

    // Check if login is required - handle both response structures
    const status = response.data?.status || response.status;
    if (status === 'login_required') {
      hideLoading();
      const message = response.message || response.data?.message || 'Please login in the browser window';
      showLoginAlert(message);
      startAutomationStatusPoll();
      return;
    }

    showToast(response.message || 'Application submitted', 'success');
    await loadJobs();
  } catch (error) {
    showToast(`Failed to apply: ${error.message}`, 'error');
  } finally {
    hideLoading();
  }
}

// Apply to selected jobs
async function applySelected() {
  if (selectedJobs.size === 0) {
    showToast('No jobs selected', 'error');
    return;
  }

  showLoading(`Applying to ${selectedJobs.size} jobs...`);

  try {
    const response = await apiCall('/jobs/apply-batch', {
      method: 'POST',
      body: JSON.stringify({ jobIds: Array.from(selectedJobs) }),
    });

    showToast(response.message, 'success');
    selectedJobs.clear();

    // Start polling for automation status
    startAutomationStatusPoll();

    await loadJobs();
  } catch (error) {
    showToast(`Failed to apply: ${error.message}`, 'error');
  } finally {
    hideLoading();
  }
}

// Apply from review modal
function applyToJob() {
  if (currentJob) {
    closeModal('reviewModal');
    applyToSingleJob(currentJob.id);
  }
}

// Skip job from review modal
async function skipJob() {
  if (currentJob) {
    try {
      await apiCall(`/jobs/${currentJob.id}/skip`, { method: 'POST' });
      showToast('Job skipped', 'success');
      closeModal('reviewModal');
      await loadJobs();
    } catch (error) {
      showToast(`Failed to skip: ${error.message}`, 'error');
    }
  }
}

// Save for later
function saveForLater() {
  closeModal('reviewModal');
  showToast('Job saved for later', 'success');
}

// Show input modal for job
function showInputModal(jobId) {
  currentJob = jobs.find((job) => job.id === jobId);
  if (!currentJob) return;

  // Check if requiredInputs has actual items, otherwise use fallback
  const inputs = (currentJob.requiredInputs && currentJob.requiredInputs.length > 0)
    ? currentJob.requiredInputs
    : [
      {
        field: 'whyThisCompany',
        label: `Why are you excited about ${currentJob.company}?`,
        type: 'textarea',
        required: true,
      },
      {
        field: 'yearsExperience',
        label: 'Years of relevant experience',
        type: 'number',
        required: true,
      },
    ];

  document.getElementById('inputBody').innerHTML = `
    <p style="margin-bottom: 20px; color: var(--text-secondary);">
      <strong>${currentJob.title}</strong> @ <strong>${currentJob.company}</strong> requires the following information:
    </p>
    ${inputs
      .map(
        (input) => `
      <div class="input-group">
        <label for="input-${input.field}">${input.label} ${input.required ? '*' : ''}</label>
        ${
          input.type === 'textarea'
            ? `<textarea id="input-${input.field}" placeholder="Enter your answer...">${
                input.value || ''
              }</textarea>`
            : input.type === 'select'
            ? `<select id="input-${input.field}">
                ${input.options?.map((opt) => `<option value="${opt}">${opt}</option>`).join('')}
               </select>`
            : `<input type="${input.type}" id="input-${input.field}" value="${input.value || ''}" placeholder="Enter your answer...">`
        }
      </div>
    `
      )
      .join('')}
  `;

  showModal('inputModal');
}

// Submit inputs
async function submitInputs() {
  if (!currentJob) return;

  const inputs = {};
  const inputElements = document.querySelectorAll('#inputBody input, #inputBody textarea, #inputBody select');

  inputElements.forEach((el) => {
    const field = el.id.replace('input-', '');
    inputs[field] = el.value;
  });

  const saveForFuture = document.getElementById('saveAnswers').checked;

  try {
    await apiCall(`/jobs/${currentJob.id}/input`, {
      method: 'POST',
      body: JSON.stringify({ inputs, saveForFuture }),
    });

    showToast('Inputs saved, applying...', 'success');
    closeModal('inputModal');

    // Now apply
    await applyToSingleJob(currentJob.id);
  } catch (error) {
    showToast(`Failed to save inputs: ${error.message}`, 'error');
  }
}

// Show pending inputs
function showPendingInputs() {
  const pendingJobs = jobs.filter((job) => job.status === 'needs_input');
  if (pendingJobs.length > 0) {
    showInputModal(pendingJobs[0].id);
  }
}

// Retry failed job
async function retryJob(jobId) {
  await applyToSingleJob(jobId);
}

// Sync to Notion
async function syncToNotion() {
  showLoading('Syncing to Notion...');

  try {
    const response = await apiCall('/notion/sync');
    showToast('Synced to Notion successfully', 'success');
  } catch (error) {
    showToast(`Sync failed: ${error.message}`, 'error');
  } finally {
    hideLoading();
  }
}

// Show stats modal
async function showStats() {
  try {
    const response = await apiCall('/stats');
    const stats = response.data.applications;

    document.getElementById('statsBody').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${stats.totalSearched}</div>
          <div class="stat-label">Total Jobs</div>
        </div>
        <div class="stat-card success">
          <div class="stat-value">${stats.totalApplied}</div>
          <div class="stat-label">Applied</div>
        </div>
        <div class="stat-card warning">
          <div class="stat-value">${stats.totalPendingInput}</div>
          <div class="stat-label">Pending Input</div>
        </div>
        <div class="stat-card danger">
          <div class="stat-value">${stats.totalFailed}</div>
          <div class="stat-label">Failed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${stats.totalSkipped}</div>
          <div class="stat-label">Skipped</div>
        </div>
        <div class="stat-card success">
          <div class="stat-value">${stats.successRate.toFixed(1)}%</div>
          <div class="stat-label">Success Rate</div>
        </div>
      </div>

      <h3 style="margin: 24px 0 16px; color: var(--text-secondary);">Applications by Platform</h3>
      <div style="display: flex; flex-wrap: wrap; gap: 12px;">
        ${Object.entries(stats.byPlatform)
          .filter(([_, count]) => count > 0)
          .map(
            ([platform, count]) => `
          <div class="stat-card" style="flex: 1; min-width: 100px;">
            <div class="stat-value">${count}</div>
            <div class="stat-label">${platform}</div>
          </div>
        `
          )
          .join('')}
      </div>
    `;

    showModal('statsModal');
  } catch (error) {
    showToast(`Failed to load stats: ${error.message}`, 'error');
  }
}

// Show profile modal
async function showProfile() {
  if (!profile) {
    await loadProfile();
  }

  if (!profile) {
    showToast('Profile not found', 'error');
    return;
  }

  document.getElementById('profileBody').innerHTML = `
    <div class="profile-section">
      <h3>Personal Information</h3>
      <div class="profile-grid">
        <div class="profile-item">
          <strong>Name</strong>
          ${profile.personalInfo.name}
        </div>
        <div class="profile-item">
          <strong>Email</strong>
          ${profile.personalInfo.email}
        </div>
        <div class="profile-item">
          <strong>Phone</strong>
          ${profile.personalInfo.phone}
        </div>
        <div class="profile-item">
          <strong>Location</strong>
          ${profile.personalInfo.location}
        </div>
        <div class="profile-item">
          <strong>LinkedIn</strong>
          <a href="${profile.personalInfo.linkedin}" target="_blank">${profile.personalInfo.linkedin}</a>
        </div>
        <div class="profile-item">
          <strong>GitHub</strong>
          <a href="${profile.personalInfo.github}" target="_blank">${profile.personalInfo.github}</a>
        </div>
      </div>
    </div>

    <div class="profile-section">
      <h3>Professional</h3>
      <div class="profile-grid">
        <div class="profile-item">
          <strong>Current Title</strong>
          ${profile.professional.currentTitle}
        </div>
        <div class="profile-item">
          <strong>Current Company</strong>
          ${profile.professional.currentCompany}
        </div>
        <div class="profile-item">
          <strong>Experience</strong>
          ${profile.professional.yearsOfExperience} years
        </div>
        <div class="profile-item">
          <strong>Notice Period</strong>
          ${profile.professional.noticePeriod}
        </div>
      </div>
    </div>

    <div class="profile-section">
      <h3>Target Roles</h3>
      <div style="display: flex; flex-wrap: wrap; gap: 8px;">
        ${profile.targetRoles.map((role) => `<span class="skill-tag skill-match">${role}</span>`).join('')}
      </div>
    </div>

    <div class="profile-section">
      <h3>Skills</h3>
      <div style="display: flex; flex-wrap: wrap; gap: 8px;">
        ${[...profile.skills.languages, ...profile.skills.frameworks, ...profile.skills.tools]
          .slice(0, 20)
          .map((skill) => `<span class="skill-tag skill-match">${skill}</span>`)
          .join('')}
      </div>
    </div>
  `;

  showModal('profileModal');
}

// Modal functions
function showModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

// Loading functions
function showLoading(text = 'Loading...') {
  elements.loadingText.textContent = text;
  elements.loadingOverlay.classList.add('active');
}

function hideLoading() {
  elements.loadingOverlay.classList.remove('active');
}

// Toast notification
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 5000);
}

// Utility functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Close modals on outside click
document.querySelectorAll('.modal').forEach((modal) => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal.active').forEach((modal) => {
      modal.classList.remove('active');
    });
  }
});

// =====================
// Login Alert Functions
// =====================

// Show login alert
function showLoginAlert(message) {
  const loginAlert = document.getElementById('loginAlert');
  const loginMessage = document.getElementById('loginMessage');

  if (loginMessage) {
    loginMessage.textContent = message;
  }

  if (loginAlert) {
    loginAlert.style.display = 'flex';
  }
}

// Hide login alert
function hideLoginAlert() {
  const loginAlert = document.getElementById('loginAlert');
  if (loginAlert) {
    loginAlert.style.display = 'none';
  }
}

// Signal login complete
async function signalLoginComplete() {
  showLoading('Continuing application...');
  hideLoginAlert();
  stopAutomationStatusPoll();

  try {
    console.log('Signaling login complete...');
    const response = await apiCall('/automation/login-complete', { method: 'POST' });
    console.log('Login complete response:', response);

    // Validate response
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid response from server');
    }

    if (response.success) {
      showToast(response.message || 'Application continued', 'success');
    } else {
      showToast(response.error || 'Failed to continue application', 'error');
    }

    await loadJobs();

    // Continue polling if there's still activity
    try {
      const status = await apiCall('/automation/status');
      if (status && status.data && (status.data.isActive || status.data.loginRequired)) {
        startAutomationStatusPoll();

        // If still needs login, show alert again
        if (status.data.loginRequired) {
          showLoginAlert(status.data.message || 'Please login in the browser window');
        }
      }
    } catch (statusError) {
      console.warn('Failed to check automation status:', statusError);
    }
  } catch (error) {
    console.error('Login complete error:', error);
    showToast(`Error: ${error.message || 'Unknown error'}`, 'error');
  } finally {
    hideLoading();
  }
}

// Cancel automation
async function cancelAutomation() {
  hideLoginAlert();
  stopAutomationStatusPoll();

  try {
    await apiCall('/automation/cancel', { method: 'POST' });
    showToast('Automation cancelled', 'info');
    await loadJobs();
  } catch (error) {
    showToast(`Error cancelling: ${error.message}`, 'error');
  }
}

// Start polling for automation status
function startAutomationStatusPoll() {
  if (automationStatusPoll) {
    return; // Already polling
  }

  automationStatusPoll = setInterval(async () => {
    try {
      const response = await apiCall('/automation/status');
      const status = response.data;

      if (status.loginRequired) {
        showLoginAlert(status.message || `Please login to ${status.loginPlatform}`);
      } else {
        hideLoginAlert();
      }

      // Stop polling if automation is complete
      if (!status.isActive && !status.loginRequired) {
        stopAutomationStatusPoll();
        await loadJobs();
      }
    } catch (error) {
      console.error('Status poll error:', error);
    }
  }, 2000); // Poll every 2 seconds
}

// Stop polling
function stopAutomationStatusPoll() {
  if (automationStatusPoll) {
    clearInterval(automationStatusPoll);
    automationStatusPoll = null;
  }
}
