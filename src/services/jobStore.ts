import fs from 'fs';
import path from 'path';
import { Job, JobStatus, ApplicationStats, Platform } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Local storage for job data
 */

class JobStore {
  private jobs: Map<string, Job> = new Map();
  private appliedJobsPath: string;
  private pendingInputsPath: string;

  constructor() {
    this.appliedJobsPath = config.appliedJobsPath;
    this.pendingInputsPath = config.pendingInputsPath;
    this.loadFromDisk();
  }

  /**
   * Load jobs from disk
   */
  private loadFromDisk(): void {
    try {
      // Create data directory if it doesn't exist
      const dataDir = path.dirname(this.appliedJobsPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Load applied jobs
      if (fs.existsSync(this.appliedJobsPath)) {
        const data = JSON.parse(fs.readFileSync(this.appliedJobsPath, 'utf-8'));
        for (const job of data) {
          this.jobs.set(job.id, job);
        }
        logger.info(`Loaded ${this.jobs.size} jobs from disk`);
      }
    } catch (error) {
      logger.error('Error loading jobs from disk:', error);
    }
  }

  /**
   * Save jobs to disk
   */
  private saveToDisk(): void {
    try {
      const jobsArray = Array.from(this.jobs.values());
      fs.writeFileSync(this.appliedJobsPath, JSON.stringify(jobsArray, null, 2));
      logger.debug(`Saved ${jobsArray.length} jobs to disk`);
    } catch (error) {
      logger.error('Error saving jobs to disk:', error);
    }
  }

  /**
   * Add or update a job
   */
  addJob(job: Job): void {
    this.jobs.set(job.id, job);
    this.saveToDisk();
  }

  /**
   * Add multiple jobs (from search results)
   */
  addJobs(jobs: Job[]): void {
    for (const job of jobs) {
      // Check if job URL already exists (avoid duplicates)
      const existing = Array.from(this.jobs.values()).find((j) => j.url === job.url);
      if (!existing) {
        this.jobs.set(job.id, job);
      }
    }
    this.saveToDisk();
  }

  /**
   * Get a job by ID
   */
  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /**
   * Get all jobs
   */
  getAllJobs(): Job[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get jobs by status
   */
  getJobsByStatus(status: JobStatus): Job[] {
    return Array.from(this.jobs.values()).filter((job) => job.status === status);
  }

  /**
   * Get jobs by platform
   */
  getJobsByPlatform(platform: Platform): Job[] {
    return Array.from(this.jobs.values()).filter((job) => job.platform === platform);
  }

  /**
   * Update job status
   */
  updateJobStatus(id: string, status: JobStatus, additionalData?: Partial<Job>): void {
    const job = this.jobs.get(id);
    if (job) {
      job.status = status;
      if (additionalData) {
        Object.assign(job, additionalData);
      }
      if (status === 'applied') {
        job.appliedDate = new Date().toISOString();
      }
      this.saveToDisk();
      logger.info(`Job ${id} status updated to ${status}`);
    }
  }

  /**
   * Add required inputs to a job
   */
  setRequiredInputs(id: string, inputs: Job['requiredInputs']): void {
    const job = this.jobs.get(id);
    if (job) {
      job.requiredInputs = inputs;
      job.status = 'needs_input';
      this.saveToDisk();
    }
  }

  /**
   * Set user inputs for a job
   */
  setUserInputs(id: string, inputs: Record<string, string>): void {
    const job = this.jobs.get(id);
    if (job) {
      job.userInputs = inputs;
      job.status = 'ready'; // Ready to retry
      this.saveToDisk();
    }
  }

  /**
   * Get jobs that need user input
   */
  getJobsNeedingInput(): Job[] {
    return this.getJobsByStatus('needs_input');
  }

  /**
   * Check if a job URL was already applied to
   */
  isAlreadyApplied(url: string): boolean {
    return Array.from(this.jobs.values()).some(
      (job) => job.url === url && job.status === 'applied'
    );
  }

  /**
   * Delete a job
   */
  deleteJob(id: string): void {
    this.jobs.delete(id);
    this.saveToDisk();
  }

  /**
   * Clear all jobs
   */
  clearAll(): void {
    this.jobs.clear();
    this.saveToDisk();
  }

  /**
   * Get application statistics
   */
  getStats(): ApplicationStats {
    const jobs = Array.from(this.jobs.values());

    const byPlatform: Record<Platform, number> = {
      linkedin: 0,
      lever: 0,
      greenhouse: 0,
      wellfound: 0,
      workable: 0,
      company_website: 0,
      naukri: 0,
      indeed: 0,
      unknown: 0,
    };

    const byDate: Record<string, number> = {};

    let totalApplied = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    let totalPendingInput = 0;

    for (const job of jobs) {
      // Count by platform (only applied jobs)
      if (job.status === 'applied') {
        byPlatform[job.platform]++;
        totalApplied++;

        // Count by date
        if (job.appliedDate) {
          const date = job.appliedDate.split('T')[0];
          byDate[date] = (byDate[date] || 0) + 1;
        }
      } else if (job.status === 'failed') {
        totalFailed++;
      } else if (job.status === 'skipped') {
        totalSkipped++;
      } else if (job.status === 'needs_input') {
        totalPendingInput++;
      }
    }

    const successRate = jobs.length > 0 ? (totalApplied / jobs.length) * 100 : 0;

    return {
      totalSearched: jobs.length,
      totalApplied,
      totalFailed,
      totalSkipped,
      totalPendingInput,
      byPlatform,
      byDate,
      successRate,
    };
  }
}

// Export singleton instance
export const jobStore = new JobStore();
