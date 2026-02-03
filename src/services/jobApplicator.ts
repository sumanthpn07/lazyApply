import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { Job, RequiredInput, Platform, AutomationStatus } from '../types';
import { config } from '../config';
import { logger, logApplication } from '../utils/logger';
import { profileService } from './profileService';
import { jobStore } from './jobStore';
import { rateLimiter } from '../utils/rateLimiter';
import {
  randomDelay,
  addStealthScripts,
  waitForPageLoad,
  checkForBotDetection,
  randomViewport,
  randomUserAgent,
} from '../utils/antiBot';
import { detectPlatformFromUrl, getLoginUrl } from '../utils/platformDetector';
import path from 'path';
import fs from 'fs';

// Import platform handlers
import { getPlatformHandler } from '../platforms';

/**
 * Job Applicator Service
 * Handles browser automation for applying to jobs
 */

interface ApplicationResult {
  success: boolean;
  jobId: string;
  status: 'applied' | 'needs_input' | 'failed' | 'login_required';
  message: string;
  requiredInputs?: RequiredInput[];
  screenshotPath?: string;
  error?: string;
  loginUrl?: string;
}

interface QueueItem {
  job: Job;
  retryCount: number;
}

interface LoginState {
  required: boolean;
  platform: Platform | null;
  loginUrl: string | null;
  jobId: string | null;
}

class JobApplicator {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private queue: QueueItem[] = [];
  private isProcessing: boolean = false;
  private isPaused: boolean = false;
  private currentJob: Job | null = null;
  private activePage: Page | null = null;
  private loginState: LoginState = {
    required: false,
    platform: null,
    loginUrl: null,
    jobId: null,
  };
  private loginResolve: ((value: boolean) => void) | null = null;

  /**
   * Initialize the browser
   */
  async initialize(): Promise<void> {
    if (this.browser) {
      return;
    }

    logger.info('Initializing browser...');

    const viewport = randomViewport();

    this.browser = await chromium.launch({
      headless: config.headless,
      slowMo: config.slowMo,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
    });

    this.context = await this.browser.newContext({
      viewport,
      userAgent: randomUserAgent(),
      locale: 'en-US',
      timezoneId: 'America/Los_Angeles',
      geolocation: { latitude: 37.7749, longitude: -122.4194 },
      permissions: ['geolocation'],
    });

    // Add stealth scripts to all new pages
    this.context.on('page', async (page) => {
      await addStealthScripts(page);
    });

    logger.info('Browser initialized');
  }

  /**
   * Close the browser
   */
  async close(): Promise<void> {
    if (this.activePage) {
      await this.activePage.close().catch(() => {});
      this.activePage = null;
    }

    if (this.context) {
      await this.context.close();
      this.context = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    this.loginState = {
      required: false,
      platform: null,
      loginUrl: null,
      jobId: null,
    };

    logger.info('Browser closed');
  }

  /**
   * Create a new page
   */
  async createPage(): Promise<Page> {
    if (!this.context) {
      await this.initialize();
    }

    const page = await this.context!.newPage();
    await addStealthScripts(page);

    return page;
  }

  /**
   * Apply to a single job
   */
  async applyToJob(job: Job): Promise<ApplicationResult> {
    this.currentJob = job;

    try {
      logger.info(`Starting application for ${job.title} at ${job.company}`);
      logApplication(job.id, job.company, 'started');

      // Check rate limit
      const rateCheck = rateLimiter.canApply(job.platform);
      if (!rateCheck.allowed) {
        return {
          success: false,
          jobId: job.id,
          status: 'failed',
          message: rateCheck.reason || 'Rate limit exceeded',
          error: rateCheck.reason,
        };
      }

      // Initialize browser if needed
      await this.initialize();

      // Create new page or reuse active page
      if (!this.activePage || this.activePage.isClosed()) {
        this.activePage = await this.createPage();
      }
      const page = this.activePage;

      // Detect platform from URL if not already set correctly
      const detectedPlatform = detectPlatformFromUrl(job.url);
      if (job.platform === 'company_website' || job.platform === 'unknown') {
        job.platform = detectedPlatform;
        logger.info(`Detected platform: ${detectedPlatform} for URL: ${job.url}`);
      }

      // Navigate to job URL
      logger.info(`Navigating to: ${job.url}`);
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitForPageLoad(page);

      // Check for bot detection
      if (await checkForBotDetection(page)) {
        const screenshotPath = await this.takeScreenshot(page, job.id, 'bot-detected');
        return {
          success: false,
          jobId: job.id,
          status: 'failed',
          message: 'Bot detection triggered',
          screenshotPath,
          error: 'Bot detection triggered. Please try again later.',
        };
      }

      // Get platform-specific handler
      const handler = getPlatformHandler(job.platform);

      // Apply using platform handler
      const result = await handler.apply(page, job, profileService);

      // Handle login required status
      if (result.status === 'login_required') {
        logger.info(`Login required for ${job.platform}`);

        // Set login state
        this.loginState = {
          required: true,
          platform: job.platform,
          loginUrl: result.loginUrl || getLoginUrl(job.platform) || page.url(),
          jobId: job.id,
        };

        // Update job status
        jobStore.updateJobStatus(job.id, 'login_required');

        // Take screenshot
        const screenshotPath = await this.takeScreenshot(page, job.id, 'login-required');

        // DON'T close the page - keep it open for user to login
        return {
          success: false,
          jobId: job.id,
          status: 'login_required',
          message: result.message || `Please login to ${job.platform} in the browser window`,
          screenshotPath,
          loginUrl: this.loginState.loginUrl || undefined,
        };
      }

      // Record application if successful
      if (result.success) {
        rateLimiter.recordApplication(job.platform);
        logApplication(job.id, job.company, 'success');
      } else if (result.status === 'needs_input') {
        logApplication(job.id, job.company, 'needs_input');
      } else {
        logApplication(job.id, job.company, 'failed');
      }

      // Take final screenshot
      const screenshotPath = await this.takeScreenshot(
        page,
        job.id,
        result.success ? 'success' : 'final'
      );
      result.screenshotPath = screenshotPath;

      // Close page after successful or failed application (not for login_required)
      await page.close().catch(() => {});
      this.activePage = null;

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Application failed for ${job.id}: ${errorMessage}`);
      logApplication(job.id, job.company, `error: ${errorMessage}`);

      // Take error screenshot
      let screenshotPath: string | undefined;
      if (this.activePage && !this.activePage.isClosed()) {
        screenshotPath = await this.takeScreenshot(this.activePage, job.id, 'error');
        await this.activePage.close().catch(() => {});
        this.activePage = null;
      }

      return {
        success: false,
        jobId: job.id,
        status: 'failed',
        message: `Application failed: ${errorMessage}`,
        screenshotPath,
        error: errorMessage,
      };
    } finally {
      if (!this.loginState.required) {
        this.currentJob = null;
      }
    }
  }

  /**
   * Continue application after user has logged in
   */
  async continueAfterLogin(): Promise<ApplicationResult | null> {
    if (!this.loginState.required || !this.loginState.jobId) {
      logger.warn('No pending login to continue');
      return null;
    }

    const jobId = this.loginState.jobId;
    const job = jobStore.getJob(jobId);
    if (!job) {
      logger.error('Job not found for login continuation');
      this.resetLoginState();
      return null;
    }

    logger.info(`Continuing application for ${job.title} after login`);

    // Update job status back to applying
    jobStore.updateJobStatus(job.id, 'applying');

    // If we have an active page, try to continue
    if (this.activePage && !this.activePage.isClosed()) {
      try {
        // Reset login state only after we've saved the job info
        this.resetLoginState();

        // Navigate back to the job
        logger.info(`Navigating back to: ${job.url}`);
        await this.activePage.goto(job.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForPageLoad(this.activePage);

        // Get handler and try again
        const handler = getPlatformHandler(job.platform);
        const result = await handler.apply(this.activePage, job, profileService);

        // Update job status based on result
        if (result.success) {
          rateLimiter.recordApplication(job.platform);
          jobStore.updateJobStatus(job.id, 'applied', {
            screenshotPath: result.screenshotPath,
          });
          logApplication(job.id, job.company, 'success');
        } else if (result.status === 'needs_input') {
          jobStore.setRequiredInputs(job.id, result.requiredInputs);
          logApplication(job.id, job.company, 'needs_input');
        } else if (result.status === 'login_required') {
          // Still needs login - restore login state
          this.loginState = {
            required: true,
            platform: job.platform,
            loginUrl: result.loginUrl || getLoginUrl(job.platform) || this.activePage.url(),
            jobId: job.id,
          };
          jobStore.updateJobStatus(job.id, 'login_required');
        } else {
          jobStore.updateJobStatus(job.id, 'failed', {
            error: result.error,
            screenshotPath: result.screenshotPath,
          });
          logApplication(job.id, job.company, 'failed');
        }

        // Take screenshot (only if not still requiring login)
        if (result.status !== 'login_required') {
          try {
            const screenshotPath = await this.takeScreenshot(
              this.activePage,
              job.id,
              result.success ? 'success' : 'final'
            );
            result.screenshotPath = screenshotPath;
          } catch (e) {
            logger.warn('Failed to take screenshot:', e);
          }

          // Close page
          await this.activePage.close().catch(() => {});
          this.activePage = null;
        }

        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Continue after login failed: ${errorMessage}`);

        // Ensure login state is reset on error
        this.resetLoginState();

        if (this.activePage && !this.activePage.isClosed()) {
          await this.activePage.close().catch(() => {});
          this.activePage = null;
        }

        jobStore.updateJobStatus(job.id, 'failed', { error: errorMessage });

        return {
          success: false,
          jobId: job.id,
          status: 'failed',
          message: `Application failed after login: ${errorMessage}`,
          error: errorMessage,
        };
      }
    } else {
      // No active page - reset login state and retry from scratch
      logger.info('No active page, retrying application from scratch');
      this.resetLoginState();
      return this.applyToJob(job);
    }
  }

  /**
   * Reset login state
   */
  private resetLoginState(): void {
    this.loginState = {
      required: false,
      platform: null,
      loginUrl: null,
      jobId: null,
    };
    if (this.loginResolve) {
      this.loginResolve(true);
      this.loginResolve = null;
    }
  }

  /**
   * Take a screenshot
   */
  private async takeScreenshot(
    page: Page,
    jobId: string,
    suffix: string
  ): Promise<string> {
    const screenshotsDir = config.screenshotsDir;

    // Ensure directory exists
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    const filename = `${jobId}-${suffix}-${Date.now()}.png`;
    const filepath = path.join(screenshotsDir, filename);

    await page.screenshot({ path: filepath, fullPage: true });
    logger.debug(`Screenshot saved: ${filepath}`);

    return filepath;
  }

  /**
   * Add jobs to the queue
   */
  addToQueue(jobs: Job[]): void {
    for (const job of jobs) {
      if (!this.queue.find((item) => item.job.id === job.id)) {
        this.queue.push({ job, retryCount: 0 });
        logger.debug(`Added job ${job.id} to queue`);
      }
    }
    logger.info(`Queue size: ${this.queue.length}`);
  }

  /**
   * Process the queue
   */
  async processQueue(): Promise<void> {
    if (this.isProcessing || this.isPaused || this.loginState.required) {
      return;
    }

    this.isProcessing = true;
    logger.info('Starting queue processing...');

    try {
      while (this.queue.length > 0 && !this.isPaused && !this.loginState.required) {
        const item = this.queue.shift();
        if (!item) break;

        const { job, retryCount } = item;

        // Update job status
        jobStore.updateJobStatus(job.id, 'applying');

        // Apply to job
        const result = await this.applyToJob(job);

        // Handle login required - pause processing
        if (result.status === 'login_required') {
          logger.info('Pausing queue - login required');
          // Put job back in queue
          this.queue.unshift({ job, retryCount });
          break;
        }

        // Update job in store
        if (result.success) {
          jobStore.updateJobStatus(job.id, 'applied', {
            screenshotPath: result.screenshotPath,
          });
        } else if (result.status === 'needs_input') {
          jobStore.setRequiredInputs(job.id, result.requiredInputs);
        } else {
          // Failed - check if we should retry
          if (retryCount < 2 && !result.error?.includes('Bot detection')) {
            // Add back to queue for retry
            this.queue.push({ job, retryCount: retryCount + 1 });
            logger.info(`Job ${job.id} will be retried (attempt ${retryCount + 2})`);
          } else {
            jobStore.updateJobStatus(job.id, 'failed', {
              error: result.error,
              screenshotPath: result.screenshotPath,
            });
          }
        }

        // Add delay between applications
        if (this.queue.length > 0 && !this.isPaused && !this.loginState.required) {
          const delay = rateLimiter.getRandomDelay(job.platform);
          logger.info(`Waiting ${Math.round(delay / 1000)} seconds before next application...`);
          await randomDelay(delay, delay + 30000);
        }
      }
    } finally {
      this.isProcessing = false;
      logger.info('Queue processing completed');
    }
  }

  /**
   * Pause queue processing
   */
  pause(): void {
    this.isPaused = true;
    logger.info('Queue processing paused');
  }

  /**
   * Resume queue processing
   */
  resume(): void {
    this.isPaused = false;
    logger.info('Queue processing resumed');
    this.processQueue();
  }

  /**
   * Get queue status
   */
  getQueueStatus(): {
    queueLength: number;
    isProcessing: boolean;
    isPaused: boolean;
    currentJob: Job | null;
  } {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      isPaused: this.isPaused,
      currentJob: this.currentJob,
    };
  }

  /**
   * Get full automation status including login state
   */
  getAutomationStatus(): AutomationStatus {
    return {
      isActive: this.isProcessing || this.loginState.required,
      isPaused: this.isPaused,
      loginRequired: this.loginState.required,
      loginPlatform: this.loginState.platform || undefined,
      loginUrl: this.loginState.loginUrl || undefined,
      currentJob: this.currentJob || undefined,
      queueLength: this.queue.length,
      message: this.loginState.required
        ? `Please login to ${this.loginState.platform} in the browser window`
        : this.isProcessing
        ? `Processing application for ${this.currentJob?.company || 'job'}`
        : 'Ready',
    };
  }

  /**
   * Clear the queue
   */
  clearQueue(): void {
    this.queue = [];
    logger.info('Queue cleared');
  }

  /**
   * Get current active page (for debugging)
   */
  getActivePage(): Page | null {
    return this.activePage;
  }

  /**
   * Check if login is pending
   */
  isLoginPending(): boolean {
    return this.loginState.required;
  }
}

// Export singleton instance
export const jobApplicator = new JobApplicator();
