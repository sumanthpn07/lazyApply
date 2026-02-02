# LazyApply - Implementation Plan

## Overview
An automated job application tool that searches for jobs, displays them in a UI for review, and auto-applies on your behalf while syncing everything to Notion.

**User:** P N Sumanth | 5 Years Experience | Full Stack Developer

---

## Your Notion Database Schema

**Data Source ID:** `0212beb8-0977-4f02-973b-727f10db2d8f`

| Field | Type | Options |
|-------|------|---------|
| Job Title | Title | - |
| Company | Text | - |
| Role | Text | - |
| Job Link | URL | - |
| Portal | Select | LinkedIn, Naukri, Wellfound, Company Website, Referral, website portal, YC, google search |
| Status | Select | Applied, Recruiter Call, Interview, Rejected, Offer |
| Applied Date | Date | - |
| Follow-up Date | Date | - |
| Resume Version | Select | v1, v2, v3, no resume |
| Response Received | Select | Yes, No |
| Interview Stage | Select | HR, Technical, Managerial, Final |
| Notes | Text | - |

---

## Project Architecture

```
lazyApply/
├── package.json
├── tsconfig.json
├── .env                          # API keys (Brave, Notion)
├── .env.example
├── src/
│   ├── index.ts                  # Main entry - starts server
│   ├── config/
│   │   └── index.ts              # Configuration & env vars
│   ├── services/
│   │   ├── braveSearch.ts        # Brave API job search
│   │   ├── notionSync.ts         # Notion database sync
│   │   └── jobApplicator.ts      # Browser automation for applying
│   ├── platforms/
│   │   ├── index.ts              # Platform registry
│   │   ├── base.ts               # Base platform class
│   │   ├── linkedin.ts           # LinkedIn Easy Apply
│   │   ├── lever.ts              # Lever ATS
│   │   ├── greenhouse.ts         # Greenhouse ATS
│   │   ├── wellfound.ts          # Wellfound/AngelList
│   │   └── workable.ts           # Workable ATS
│   ├── api/
│   │   └── routes.ts             # Express API routes
│   ├── types/
│   │   └── index.ts              # TypeScript interfaces
│   └── utils/
│       ├── logger.ts             # Logging utility
│       ├── antiBot.ts            # Bot detection avoidance
│       └── rateLimiter.ts        # Rate limiting utility
├── public/
│   ├── index.html                # Main UI
│   ├── styles.css                # Styling
│   └── app.js                    # Frontend JavaScript
├── data/
│   ├── profile.json              # Your profile for auto-fill ✅ Created
│   ├── applied-jobs.json         # Local cache of applied jobs
│   ├── pending-inputs.json       # Jobs waiting for additional input
│   └── resumes/                  # Resume versions
│       ├── v1.pdf
│       ├── v2.pdf
│       └── v3.pdf
└── README.md
```

---

## Core Features

### 1. Job Search (Brave API)
- Search multiple job boards via Brave Search API
- Keywords: job title, location, remote, experience level
- Parse and normalize job listings from different sources
- Detect platform type (LinkedIn, Lever, Greenhouse, etc.)

### 2. Web UI Dashboard
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🚀 LazyApply                                          [Settings] [Profile] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Search Jobs                                                                │
│  ┌────────────────────┐ ┌────────────────┐ ┌────────────────────────────┐  │
│  │ Software Engineer  │ │ Remote      ▼  │ │ 🔍 Search                  │  │
│  └────────────────────┘ └────────────────┘ └────────────────────────────┘  │
│                                                                             │
│  Found 24 jobs                    [Select All] [Clear] [Filter: All ▼]     │
├─────────────────────────────────────────────────────────────────────────────┤
│  Status │ Job Title            │ Company    │ Platform   │ Actions         │
│  ───────┼──────────────────────┼────────────┼────────────┼─────────────────│
│  ☐ ⚪   │ Software Engineer    │ Google     │ LinkedIn   │ [Review] [Apply]│
│  ☐ ⚪   │ Full Stack Developer │ Stripe     │ Lever      │ [Review] [Apply]│
│  ☐ 🟡   │ Backend Engineer     │ Airbnb     │ Greenhouse │ [Review] [Fill] │ ← Needs input
│  ☑ 🟢   │ Frontend Developer   │ Meta       │ LinkedIn   │ [View] Applied  │
│  ☐ 🔴   │ Senior SWE           │ Netflix    │ Workable   │ [Review] [Retry]│ ← Failed
├─────────────────────────────────────────────────────────────────────────────┤
│  ⚠️ 2 jobs need additional information                    [Fill All Info]  │
├─────────────────────────────────────────────────────────────────────────────┤
│  Selected: 3 jobs                                                           │
│  ┌────────────────┐ ┌────────────────┐ ┌───────────────┐ ┌───────────────┐ │
│  │ 🚀 Apply Now   │ │ 📋 Sync Notion │ │ 📊 Statistics │ │ ⏸️ Pause Queue│ │
│  └────────────────┘ └────────────────┘ └───────────────┘ └───────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3. Job Review Modal
```
┌─────────────────────────────────────────────────────────────────┐
│  Software Engineer @ Google                              [Close]│
├─────────────────────────────────────────────────────────────────┤
│  📍 Location: Mountain View, CA (Remote OK)                     │
│  💰 Salary: $150k - $200k                                       │
│  🔗 Platform: LinkedIn                                          │
│  📅 Posted: 2 days ago                                          │
├─────────────────────────────────────────────────────────────────┤
│  Job Description:                                               │
│  We are looking for a Software Engineer to join our team...     │
│  [Full description here]                                        │
├─────────────────────────────────────────────────────────────────┤
│  ✅ Skills Match: JavaScript, React, Node.js, Kubernetes        │
│  ⚠️ Missing: Go (mentioned in job)                              │
├─────────────────────────────────────────────────────────────────┤
│  [Skip] [Save for Later] [🚀 Apply Now]                         │
└─────────────────────────────────────────────────────────────────┘
```

### 4. Additional Input Modal (NEW!)
```
┌─────────────────────────────────────────────────────────────────┐
│  📝 Additional Information Required                      [Close]│
│  Backend Engineer @ Airbnb                                      │
├─────────────────────────────────────────────────────────────────┤
│  The application requires the following additional info:        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Why are you excited about Airbnb? *                         ││
│  │ ┌─────────────────────────────────────────────────────────┐ ││
│  │ │ I'm excited about Airbnb's mission to create a world   │ ││
│  │ │ where anyone can belong anywhere. My experience with... │ ││
│  │ └─────────────────────────────────────────────────────────┘ ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Years of experience with distributed systems? *             ││
│  │ ┌─────────────────────────────────────────────────────────┐ ││
│  │ │ 3                                                       │ ││
│  │ └─────────────────────────────────────────────────────────┘ ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ☑ Save these answers for similar questions                     │
│                                                                 │
│  [Cancel] [Save for Later] [💾 Save & Apply]                    │
└─────────────────────────────────────────────────────────────────┘
```

### 5. Auto-Apply Engine with Smart Retry
- Playwright-based browser automation
- Platform-specific handlers
- **Smart Input Detection:**
  - Detects required fields that can't be auto-filled
  - Pauses application and queues for user input
  - Shows required fields in UI
  - Auto-retries after user provides input
- **Error Handling:**
  - Captures screenshots on failure
  - Logs detailed error messages
  - Retry mechanism with exponential backoff

### 6. Bot Detection & Rate Limiting (NEW!)

#### Anti-Bot Measures
```typescript
// Human-like behavior simulation
- Random delays between actions (2-5 seconds)
- Mouse movement simulation
- Scroll behavior mimicking
- Realistic typing speed (50-100ms between keystrokes)
- Random viewport sizes
- Rotate user agents
- Use stealth mode plugins
```

#### Rate Limiting Strategy
```
Platform          | Max Apps/Hour | Delay Between Apps | Daily Limit
------------------|---------------|--------------------|--------------
LinkedIn          | 10            | 5-8 minutes        | 50
Lever             | 20            | 2-4 minutes        | 100
Greenhouse        | 20            | 2-4 minutes        | 100
Wellfound         | 15            | 3-5 minutes        | 75
Workable          | 20            | 2-4 minutes        | 100
```

### 7. Notion Sync
- Real-time sync to your Tracker database
- Auto-create entry when job is found
- Update status when applied
- Track all metadata (portal, date, resume version)
- Store additional inputs provided

---

## Application States

| State | Icon | Description |
|-------|------|-------------|
| Ready | ⚪ | Job ready to apply |
| Needs Input | 🟡 | Requires additional information from user |
| Applying | 🔵 | Currently being processed |
| Applied | 🟢 | Successfully applied |
| Failed | 🔴 | Application failed (can retry) |
| Skipped | ⚫ | User skipped this job |

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/search` | Search jobs via Brave API |
| GET | `/api/jobs` | Get all job listings |
| GET | `/api/jobs/:id` | Get single job details |
| POST | `/api/jobs/:id/apply` | Apply to single job |
| POST | `/api/jobs/apply-batch` | Apply to multiple jobs |
| GET | `/api/jobs/pending-input` | Get jobs needing input |
| POST | `/api/jobs/:id/input` | Submit additional input |
| POST | `/api/jobs/:id/retry` | Retry failed application |
| GET | `/api/notion/sync` | Sync with Notion |
| POST | `/api/notion/add` | Add job to Notion |
| GET | `/api/profile` | Get user profile |
| PUT | `/api/profile` | Update user profile |
| GET | `/api/stats` | Get application statistics |
| GET | `/api/queue/status` | Get application queue status |
| POST | `/api/queue/pause` | Pause application queue |
| POST | `/api/queue/resume` | Resume application queue |

---

## User Flow

```
[User opens LazyApply]
        │
        ▼
[Enter search criteria: "Software Engineer", "Remote"]
        │
        ▼
[Brave API searches across job boards]
        │
        ▼
[Jobs displayed in UI with platform detection]
        │
        ▼
[User reviews jobs - clicks "Review" to see details]
        │
        ▼
[User selects jobs to apply]
        │
        ▼
[Click "Apply Now"]
        │
        ▼
[Application Queue starts processing]
        │
        ├──► [For each job:]
        │           │
        │           ▼
        │    [Rate limiter checks if safe to proceed]
        │           │
        │           ▼
        │    [Browser automation starts with anti-bot measures]
        │           │
        │           ▼
        │    [Platform-specific apply flow]
        │           │
        │           ▼
        │    [Auto-fill form + upload resume]
        │           │
        │           ├──► [All fields filled?]
        │           │           │
        │           │     YES   │   NO
        │           │     ▼     │   ▼
        │           │  [Submit] │ [Pause & Queue for Input]
        │           │     │     │   │
        │           │     │     │   ▼
        │           │     │     │ [UI shows "Needs Input" 🟡]
        │           │     │     │   │
        │           │     │     │   ▼
        │           │     │     │ [User provides input in UI]
        │           │     │     │   │
        │           │     │     │   ▼
        │           │     │     │ [Auto-retry with new input]
        │           │     │     │
        │           │     ◄─────┘
        │           │
        │           ▼
        │    [Update Notion with status]
        │           │
        │           ▼
        │    [UI shows result: 🟢 Applied / 🔴 Failed]
        │
        ▼
[Process next job in queue with delay]
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 18+ |
| Language | TypeScript |
| Backend | Express.js |
| Frontend | Vanilla HTML/CSS/JS |
| Browser Automation | Playwright + Stealth Plugin |
| Job Search | Brave Search API |
| Database Sync | Notion API (MCP) |
| Local Storage | JSON files |
| Queue Management | Bull (Redis-based) or in-memory |

---

## Configuration

### .env file
```env
BRAVE_API_KEY=BSAcDy7uvpONyvi2chIEVK8c3X-0BL4
NOTION_DATABASE_ID=0212beb8-0977-4f02-973b-727f10db2d8f
PORT=3000

# Rate Limiting
LINKEDIN_RATE_LIMIT=10
DEFAULT_RATE_LIMIT=20
DELAY_BETWEEN_APPS_MIN=120000
DELAY_BETWEEN_APPS_MAX=300000

# Browser Settings
HEADLESS=false
SLOW_MO=50
```

---

## Implementation Phases

### Phase 1: Foundation ✅
- [x] Project setup
- [x] Profile configuration
- [ ] Basic Express server
- [ ] Brave Search API integration
- [ ] Simple UI to display jobs

### Phase 2: Core Features
- [ ] Job review modal
- [ ] Additional input modal
- [ ] Notion sync integration
- [ ] Local job tracking & caching

### Phase 3: Auto-Apply
- [ ] Playwright setup with stealth
- [ ] Rate limiter implementation
- [ ] LinkedIn Easy Apply
- [ ] Lever automation
- [ ] Greenhouse automation
- [ ] Input detection & queue system

### Phase 4: Polish & Safety
- [ ] Bot detection avoidance
- [ ] Comprehensive error handling
- [ ] Retry logic with exponential backoff
- [ ] Statistics dashboard
- [ ] Resume version selection
- [ ] Saved answers database

---

## Safety & Compliance

1. **Rate Limiting**: Strict limits to avoid account bans
2. **Human-like Behavior**: Random delays, realistic interactions
3. **Stealth Mode**: Playwright stealth plugin to avoid detection
4. **Graceful Degradation**: If detected, pause and notify user
5. **User Control**: Pause/resume queue anytime
6. **Transparency**: Full logs of all actions in Notion

---

## Profile Data (Created ✅)

```json
{
  "name": "P N Sumanth",
  "email": "podonolanasumanth@gmail.com",
  "phone": "+91-7619408618",
  "linkedin": "linkedin.com/in/pnsumanth",
  "github": "github.com/sumanthpn07",
  "location": "Bangalore, India / San Francisco, USA",
  "yearsOfExperience": 5,
  "currentTitle": "Software Developer @ AtoB Supplychain Technologies",
  "skills": "JavaScript, Ruby, TypeScript, Node.js, React, Ruby on Rails, Kubernetes, AWS, GCP..."
}
```

---

## Ready to Build!

The plan is complete. Next steps:
1. Initialize Node.js project with TypeScript
2. Set up Express server
3. Implement Brave Search integration
4. Build the UI
5. Add Playwright automation
6. Connect Notion sync

**Shall I start building?**
