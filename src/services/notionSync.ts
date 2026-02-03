import { Job, NotionJobEntry, Platform } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';
import { jobStore } from './jobStore';

/**
 * Notion Sync Service
 *
 * Handles syncing job applications to Notion database
 * Uses Notion API for database operations
 */

// Notion API configuration
const NOTION_API_URL = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

// Your Notion database ID from the implementation plan
const DATABASE_ID = config.notionDatabaseId || '0212beb8-0977-4f02-973b-727f10db2d8f';

/**
 * Map platform to Notion Portal select option
 */
function mapPlatformToPortal(platform: Platform): string {
  const mapping: Record<Platform, string> = {
    linkedin: 'LinkedIn',
    lever: 'website portal',
    greenhouse: 'website portal',
    wellfound: 'Wellfound',
    workable: 'website portal',
    company_website: 'Company Website',
    naukri: 'Naukri',
    indeed: 'website portal',
    unknown: 'website portal',
  };
  return mapping[platform] || 'website portal';
}

/**
 * Map job status to Notion Status select option
 */
function mapStatusToNotion(status: string): string {
  const mapping: Record<string, string> = {
    applied: 'Applied',
    needs_input: 'Applied', // Still in progress
    failed: 'Applied', // Mark as applied but add note
    skipped: 'Applied', // Skipped tracking
  };
  return mapping[status] || 'Applied';
}

/**
 * Format date for Notion
 */
function formatDateForNotion(date?: string): string | undefined {
  if (!date) return new Date().toISOString().split('T')[0];
  return new Date(date).toISOString().split('T')[0];
}

/**
 * Create job entry properties for Notion API
 */
function createNotionProperties(job: Job): any {
  const properties: any = {
    'Job Title': {
      title: [
        {
          text: {
            content: job.title,
          },
        },
      ],
    },
    'Company': {
      rich_text: [
        {
          text: {
            content: job.company,
          },
        },
      ],
    },
    'Role': {
      rich_text: [
        {
          text: {
            content: job.title, // Using title as role
          },
        },
      ],
    },
    'Job Link': {
      url: job.url,
    },
    'Portal': {
      select: {
        name: mapPlatformToPortal(job.platform),
      },
    },
    'Status': {
      select: {
        name: mapStatusToNotion(job.status),
      },
    },
    'Applied Date': {
      date: {
        start: formatDateForNotion(job.appliedDate),
      },
    },
    'Response Received': {
      select: {
        name: 'No',
      },
    },
  };

  // Add resume version if available
  if (job.resumeVersion) {
    properties['Resume Version'] = {
      select: {
        name: job.resumeVersion,
      },
    };
  }

  // Add notes if there's an error or additional info
  if (job.notes || job.error) {
    properties['Notes'] = {
      rich_text: [
        {
          text: {
            content: job.notes || job.error || '',
          },
        },
      ],
    };
  }

  return properties;
}

class NotionSync {
  private apiKey: string | null = null;

  constructor() {
    // Note: Notion API key will need to be provided
    // For now, we'll log operations
  }

  /**
   * Set the Notion API key
   */
  setApiKey(key: string): void {
    this.apiKey = key;
    logger.info('Notion API key configured');
  }

  /**
   * Add a job to Notion database
   */
  async addJob(job: Job): Promise<{ success: boolean; pageId?: string; error?: string }> {
    logger.info(`Adding job to Notion: ${job.title} at ${job.company}`);

    if (!this.apiKey) {
      logger.warn('Notion API key not configured. Skipping sync.');
      return { success: false, error: 'Notion API key not configured' };
    }

    try {
      const response = await fetch(`${NOTION_API_URL}/pages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Notion-Version': NOTION_VERSION,
        },
        body: JSON.stringify({
          parent: {
            database_id: DATABASE_ID,
          },
          properties: createNotionProperties(job),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { message?: string };
        throw new Error(errorData.message || 'Notion API error');
      }

      const data = await response.json() as { id: string };
      const pageId = data.id;

      // Update job with Notion page ID
      jobStore.updateJobStatus(job.id, job.status, { notionPageId: pageId });

      logger.info(`Job added to Notion with page ID: ${pageId}`);
      return { success: true, pageId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to add job to Notion: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Update a job in Notion
   */
  async updateJob(job: Job): Promise<{ success: boolean; error?: string }> {
    if (!job.notionPageId) {
      // Create new entry instead
      return this.addJob(job);
    }

    if (!this.apiKey) {
      return { success: false, error: 'Notion API key not configured' };
    }

    try {
      const response = await fetch(`${NOTION_API_URL}/pages/${job.notionPageId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Notion-Version': NOTION_VERSION,
        },
        body: JSON.stringify({
          properties: createNotionProperties(job),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { message?: string };
        throw new Error(errorData.message || 'Notion API error');
      }

      logger.info(`Job updated in Notion: ${job.id}`);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to update job in Notion: ${errorMessage}`);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Sync all applied jobs to Notion
   */
  async syncAllApplied(): Promise<{ synced: number; failed: number; errors: string[] }> {
    const appliedJobs = jobStore.getJobsByStatus('applied');
    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    logger.info(`Syncing ${appliedJobs.length} applied jobs to Notion`);

    for (const job of appliedJobs) {
      if (job.notionPageId) {
        // Already synced, update instead
        const result = await this.updateJob(job);
        if (result.success) {
          synced++;
        } else {
          failed++;
          if (result.error) errors.push(`${job.id}: ${result.error}`);
        }
      } else {
        // New entry
        const result = await this.addJob(job);
        if (result.success) {
          synced++;
        } else {
          failed++;
          if (result.error) errors.push(`${job.id}: ${result.error}`);
        }
      }

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    logger.info(`Notion sync complete: ${synced} synced, ${failed} failed`);
    return { synced, failed, errors };
  }

  /**
   * Check if a job URL already exists in Notion
   */
  async jobExists(url: string): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }

    try {
      const response = await fetch(`${NOTION_API_URL}/databases/${DATABASE_ID}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Notion-Version': NOTION_VERSION,
        },
        body: JSON.stringify({
          filter: {
            property: 'Job Link',
            url: {
              equals: url,
            },
          },
        }),
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json() as { results?: unknown[] };
      return data.results !== undefined && data.results.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get sync status
   */
  getSyncStatus(): {
    configured: boolean;
    databaseId: string;
  } {
    return {
      configured: !!this.apiKey,
      databaseId: DATABASE_ID,
    };
  }
}

// Export singleton instance
export const notionSync = new NotionSync();

/**
 * Alternative: Use Notion MCP tool for operations
 * This function can be called from routes that have MCP access
 */
export function createNotionJobEntry(job: Job): NotionJobEntry {
  return {
    'Job Title': job.title,
    'Company': job.company,
    'Role': job.title,
    'Job Link': job.url,
    'Portal': mapPlatformToPortal(job.platform),
    'Status': mapStatusToNotion(job.status),
    'Applied Date': formatDateForNotion(job.appliedDate),
    'Response Received': 'No',
    'Resume Version': job.resumeVersion,
    'Notes': job.notes || job.error,
  };
}
