import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { Job, RequiredInput, Platform } from '../types';
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
  status: 'applied' | 'needs_input' | 'failed';
  message: string;
  requiredInputs?: RequiredInput[];
  screenshotPath?: string;
  error?: string;
}

interface QueueItem {
  job: Job;
  retryCount: number;
}

class JobApplicator {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private queue: QueueItem[] = [];
  private isProcessing: boolean = false;
  private isPaused: boolean = false;
  private currentJob: Job | null = null;

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
    if (this.context) {
      await this.context.close();
      this.context = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

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
    let page: Page | null = null;

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

      // Create new page
      page = await this.createPage();

      // Navigate to job URL
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

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Application failed for ${job.id}: ${errorMessage}`);
      logApplication(job.id, job.company, `error: ${errorMessage}`);

      // Take error screenshot
      let screenshotPath: string | undefined;
      if (page) {
        screenshotPath = await this.takeScreenshot(page, job.id, 'error');
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
      // Close the page
      if (page) {
        await page.close().catch(() => {});
      }
      this.currentJob = null;
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
    if (this.isProcessing || this.isPaused) {
      return;
    }

    this.isProcessing = true;
    logger.info('Starting queue processing...');

    try {
      while (this.queue.length > 0 && !this.isPaused) {
        const item = this.queue.shift();
        if (!item) break;

        const { job, retryCount } = item;

        // Update job status
        jobStore.updateJobStatus(job.id, 'applying');

        // Apply to job
        const result = await this.applyToJob(job);

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
        if (this.queue.length > 0 && !this.isPaused) {
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
   * Clear the queue
   */
  clearQueue(): void {
    this.queue = [];
    logger.info('Queue cleared');
  }
}

// Export singleton instance
export const jobApplicator = new JobApplicator();
