import { Router, Request, Response } from 'express';
import { searchJobs, buildSearchQueries } from '../services/braveSearch';
import { jobStore } from '../services/jobStore';
import { profileService } from '../services/profileService';
import { rateLimiter } from '../utils/rateLimiter';
import { logger } from '../utils/logger';
import { Job, SearchParams, ApiResponse } from '../types';

const router = Router();

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * GET /api/search
 * Search for jobs using Brave API
 */
router.get('/search', async (req: Request, res: Response) => {
  try {
    const { query, location, remote } = req.query;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter is required',
      } as ApiResponse<null>);
    }

    const params: SearchParams = {
      query: String(query),
      location: location ? String(location) : undefined,
      remote: remote === 'true',
    };

    const jobs = await searchJobs(params);

    // Add jobs to store (avoiding duplicates)
    jobStore.addJobs(jobs);

    res.json({
      success: true,
      data: jobs,
      message: `Found ${jobs.length} jobs`,
    } as ApiResponse<Job[]>);
  } catch (error) {
    logger.error('Search error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Search failed',
    } as ApiResponse<null>);
  }
});

/**
 * POST /api/search/bulk
 * Search for multiple job titles and locations
 */
router.post('/search/bulk', async (req: Request, res: Response) => {
  try {
    const { titles, locations, remote } = req.body;

    if (!titles || !Array.isArray(titles)) {
      return res.status(400).json({
        success: false,
        error: 'titles array is required',
      });
    }

    const searchLocations = locations || ['Remote'];
    const queries = buildSearchQueries(titles, searchLocations, remote);

    let allJobs: Job[] = [];

    for (const params of queries) {
      const jobs = await searchJobs(params);
      allJobs = [...allJobs, ...jobs];

      // Small delay between searches to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Remove duplicates
    const uniqueJobs = allJobs.filter(
      (job, index, self) => index === self.findIndex((j) => j.url === job.url)
    );

    jobStore.addJobs(uniqueJobs);

    res.json({
      success: true,
      data: uniqueJobs,
      message: `Found ${uniqueJobs.length} unique jobs from ${queries.length} searches`,
    });
  } catch (error) {
    logger.error('Bulk search error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Bulk search failed',
    });
  }
});

/**
 * GET /api/jobs
 * Get all jobs from store
 */
router.get('/jobs', (req: Request, res: Response) => {
  const { status, platform } = req.query;

  let jobs = jobStore.getAllJobs();

  if (status) {
    jobs = jobs.filter((job) => job.status === status);
  }

  if (platform) {
    jobs = jobs.filter((job) => job.platform === platform);
  }

  res.json({
    success: true,
    data: jobs,
  } as ApiResponse<Job[]>);
});

/**
 * GET /api/jobs/pending-input
 * Get jobs that need user input
 * NOTE: This must come BEFORE /api/jobs/:id to avoid route conflict
 */
router.get('/jobs/pending-input', (req: Request, res: Response) => {
  const jobs = jobStore.getJobsNeedingInput();
  res.json({
    success: true,
    data: jobs,
  });
});

/**
 * POST /api/jobs/apply-batch
 * Apply to multiple jobs
 * NOTE: This must come BEFORE /api/jobs/:id to avoid route conflict
 */
router.post('/jobs/apply-batch', async (req: Request, res: Response) => {
  const { jobIds } = req.body;

  if (!jobIds || !Array.isArray(jobIds)) {
    return res.status(400).json({
      success: false,
      error: 'jobIds array is required',
    });
  }

  const results: { jobId: string; status: string; error?: string }[] = [];

  for (const jobId of jobIds) {
    const job = jobStore.getJob(jobId);

    if (!job) {
      results.push({ jobId, status: 'error', error: 'Job not found' });
      continue;
    }

    const rateCheck = rateLimiter.canApply(job.platform);
    if (!rateCheck.allowed) {
      results.push({ jobId, status: 'rate_limited', error: rateCheck.reason });
      continue;
    }

    jobStore.updateJobStatus(jobId, 'applying');
    results.push({ jobId, status: 'queued' });

    // Simulate applying (TODO: Replace with Playwright automation)
    setTimeout(() => {
      rateLimiter.recordApplication(job.platform);
      jobStore.updateJobStatus(jobId, 'applied');
    }, 2000 + Math.random() * 3000);
  }

  res.json({
    success: true,
    data: results,
    message: `${results.filter((r) => r.status === 'queued').length} jobs queued for application`,
  });
});

/**
 * GET /api/jobs/:id
 * Get a single job by ID
 */
router.get('/jobs/:id', (req: Request, res: Response) => {
  const job = jobStore.getJob(req.params.id);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Job not found',
    });
  }

  res.json({
    success: true,
    data: job,
  });
});

/**
 * DELETE /api/jobs/:id
 * Delete a job
 */
router.delete('/jobs/:id', (req: Request, res: Response) => {
  jobStore.deleteJob(req.params.id);
  res.json({
    success: true,
    message: 'Job deleted',
  });
});

/**
 * POST /api/jobs/:id/skip
 * Skip a job
 */
router.post('/jobs/:id/skip', (req: Request, res: Response) => {
  jobStore.updateJobStatus(req.params.id, 'skipped');
  res.json({
    success: true,
    message: 'Job skipped',
  });
});

/**
 * POST /api/jobs/:id/input
 * Provide user inputs for a job
 */
router.post('/jobs/:id/input', (req: Request, res: Response) => {
  const { inputs, saveForFuture } = req.body;

  if (!inputs || typeof inputs !== 'object') {
    return res.status(400).json({
      success: false,
      error: 'inputs object is required',
    });
  }

  const job = jobStore.getJob(req.params.id);
  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Job not found',
    });
  }

  // Save inputs to job
  jobStore.setUserInputs(req.params.id, inputs);

  // Optionally save answers for future use
  if (saveForFuture) {
    for (const [question, answer] of Object.entries(inputs)) {
      profileService.saveAnswer(question, answer as string);
    }
  }

  res.json({
    success: true,
    message: 'Inputs saved, job ready for retry',
  });
});

/**
 * POST /api/jobs/:id/apply
 * Apply to a single job (placeholder - will be implemented with Playwright)
 */
router.post('/jobs/:id/apply', async (req: Request, res: Response) => {
  const job = jobStore.getJob(req.params.id);

  if (!job) {
    return res.status(404).json({
      success: false,
      error: 'Job not found',
    });
  }

  // Check rate limit
  const rateCheck = rateLimiter.canApply(job.platform);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      error: rateCheck.reason,
      waitTime: rateCheck.waitTime,
    });
  }

  // Update status to applying
  jobStore.updateJobStatus(job.id, 'applying');

  // TODO: Implement actual application with Playwright
  // For now, just simulate success
  setTimeout(() => {
    rateLimiter.recordApplication(job.platform);
    jobStore.updateJobStatus(job.id, 'applied');
  }, 2000);

  res.json({
    success: true,
    message: 'Application started',
    data: { jobId: job.id },
  });
});

/**
 * GET /api/profile
 * Get user profile
 */
router.get('/profile', (req: Request, res: Response) => {
  const profile = profileService.getProfile();

  if (!profile) {
    return res.status(404).json({
      success: false,
      error: 'Profile not found',
    });
  }

  res.json({
    success: true,
    data: profile,
  });
});

/**
 * PUT /api/profile
 * Update user profile
 */
router.put('/profile', (req: Request, res: Response) => {
  const updates = req.body;
  profileService.updateProfile(updates);

  res.json({
    success: true,
    message: 'Profile updated',
  });
});

/**
 * POST /api/profile/save-answer
 * Save an answer for future use
 */
router.post('/profile/save-answer', (req: Request, res: Response) => {
  const { question, answer } = req.body;

  if (!question || !answer) {
    return res.status(400).json({
      success: false,
      error: 'question and answer are required',
    });
  }

  profileService.saveAnswer(question, answer);

  res.json({
    success: true,
    message: 'Answer saved',
  });
});

/**
 * GET /api/stats
 * Get application statistics
 */
router.get('/stats', (req: Request, res: Response) => {
  const stats = jobStore.getStats();
  const rateLimitStats = rateLimiter.getStats();

  res.json({
    success: true,
    data: {
      applications: stats,
      rateLimits: rateLimitStats,
    },
  });
});

/**
 * DELETE /api/jobs
 * Clear all jobs
 */
router.delete('/jobs', (req: Request, res: Response) => {
  jobStore.clearAll();
  res.json({
    success: true,
    message: 'All jobs cleared',
  });
});

export default router;
