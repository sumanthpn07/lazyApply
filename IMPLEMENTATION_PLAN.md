# LazyApply - Implementation Plan

## Overview
An automated job application tool that searches for jobs, displays them in a UI for review, and auto-applies on your behalf while syncing everything to Notion.

---

## Your Notion Database Schema

**Data Source ID:** `collection://0212beb8-0977-4f02-973b-727f10db2d8f`

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
│       └── logger.ts             # Logging utility
├── public/
│   ├── index.html                # Main UI
│   ├── styles.css                # Styling
│   └── app.js                    # Frontend JavaScript
├── data/
│   ├── profile.json              # Your profile for auto-fill
│   ├── applied-jobs.json         # Local cache of applied jobs
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
┌─────────────────────────────────────────────────────────────────┐
│  🚀 LazyApply                                    [Settings] [?] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Search Jobs                                                    │
│  ┌──────────────────┐ ┌──────────────┐ ┌──────────────────────┐│
│  │ Software Engineer│ │ Remote    ▼  │ │ 🔍 Search            ││
│  └──────────────────┘ └──────────────┘ └──────────────────────┘│
│                                                                 │
│  Found 24 jobs                          [Select All] [Clear]   │
├─────────────────────────────────────────────────────────────────┤
│  ☐ │ Software Engineer    │ Google     │ LinkedIn  │ [Review]  │
│  ☐ │ Full Stack Developer │ Stripe     │ Lever     │ [Review]  │
│  ☐ │ Backend Engineer     │ Airbnb     │ Greenhouse│ [Review]  │
│  ☑ │ Frontend Developer   │ Meta       │ LinkedIn  │ [Applied] │
│  ☐ │ Senior SWE           │ Netflix    │ Workable  │ [Review]  │
├─────────────────────────────────────────────────────────────────┤
│  Selected: 3 jobs                                               │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────────┐  │
│  │ 🚀 Apply Now   │ │ 📋 Sync Notion │ │ 📊 View Stats      │  │
│  └────────────────┘ └────────────────┘ └────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Job Review Modal
- View full job description
- See company info
- Check if already applied (from Notion)
- Quick apply button
- Skip/Save for later

### 4. Auto-Apply Engine
- Playwright-based browser automation
- Platform-specific handlers:
  - **LinkedIn**: Easy Apply flow
  - **Lever**: Standard application form
  - **Greenhouse**: Standard application form
  - **Wellfound**: One-click apply
  - **Workable**: Standard application form
- Auto-fill profile data
- Upload appropriate resume version
- Handle multi-step forms

### 5. Notion Sync
- Real-time sync to your Tracker database
- Auto-create entry when job is found
- Update status when applied
- Track all metadata (portal, date, resume version)

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/search` | Search jobs via Brave API |
| GET | `/api/jobs` | Get cached job listings |
| GET | `/api/jobs/:id` | Get single job details |
| POST | `/api/apply` | Apply to selected jobs |
| POST | `/api/apply/:id` | Apply to single job |
| GET | `/api/notion/sync` | Sync with Notion |
| POST | `/api/notion/add` | Add job to Notion |
| GET | `/api/profile` | Get user profile |
| PUT | `/api/profile` | Update user profile |
| GET | `/api/stats` | Get application statistics |

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
        ├──► [Browser automation starts]
        │           │
        │           ▼
        │    [Platform-specific apply flow]
        │           │
        │           ▼
        │    [Auto-fill form + upload resume]
        │           │
        │           ▼
        │    [Submit application]
        │
        ▼
[Notion updated with new application]
        │
        ▼
[UI shows "Applied" status]
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 18+ |
| Language | TypeScript |
| Backend | Express.js |
| Frontend | Vanilla HTML/CSS/JS |
| Browser Automation | Playwright |
| Job Search | Brave Search API |
| Database Sync | Notion API (MCP) |
| Local Storage | JSON files |

---

## Configuration Required

### .env file
```
BRAVE_API_KEY=BSAcDy7uvpONyvi2chIEVK8c3X-0BL4
NOTION_DATA_SOURCE_ID=0212beb8-0977-4f02-973b-727f10db2d8f
PORT=3000
```

### profile.json
```json
{
  "name": "Your Full Name",
  "email": "your.email@example.com",
  "phone": "+1234567890",
  "linkedin": "https://linkedin.com/in/yourprofile",
  "location": "City, Country",
  "yearsOfExperience": 5,
  "currentTitle": "Software Engineer",
  "targetRoles": ["Software Engineer", "Full Stack Developer", "Backend Engineer"],
  "preferredLocations": ["Remote", "San Francisco", "New York"],
  "skills": ["JavaScript", "TypeScript", "React", "Node.js", "Python"],
  "education": "Bachelor's in Computer Science",
  "workAuthorization": "Authorized to work"
}
```

---

## Implementation Phases

### Phase 1: Foundation (Current)
- [x] Project setup
- [ ] Basic Express server
- [ ] Brave Search API integration
- [ ] Simple UI to display jobs

### Phase 2: Core Features
- [ ] Job review modal
- [ ] Notion sync integration
- [ ] Local job tracking

### Phase 3: Auto-Apply
- [ ] Playwright setup
- [ ] LinkedIn Easy Apply
- [ ] Lever automation
- [ ] Greenhouse automation

### Phase 4: Polish
- [ ] Error handling
- [ ] Retry logic
- [ ] Statistics dashboard
- [ ] Resume version selection

---

## Questions Before Building

1. **Your Profile Info** - I need your details for auto-filling:
   - Full Name
   - Email
   - Phone
   - LinkedIn URL
   - Current Location
   - Target Job Titles
   - Years of Experience

2. **Resume Files** - Where are your resume PDFs located?

3. **Cover Letter** - Do you have a template?

4. **Which platforms to prioritize?** (LinkedIn, Lever, Greenhouse, etc.)

---

## Ready to Build?

Once you confirm the plan and provide the profile info, I'll start building:
1. Set up the Node.js project
2. Create the web UI
3. Implement Brave Search
4. Add Notion sync
5. Build auto-apply automation

Let me know if you want any changes to this plan!
