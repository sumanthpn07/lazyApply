# 🚀 LazyApply

Automated job application tool that searches for jobs, displays them in a UI for review, and auto-applies on your behalf while syncing everything to Notion.

## Features

- **🔍 Job Search**: Search across multiple job boards using Brave Search API
- **📋 Review Jobs**: Web UI to view and filter job listings before applying
- **🤖 Auto-Apply**: Automated application with Playwright browser automation
- **📝 Smart Input Handling**: Detects required fields and prompts for additional info
- **🛡️ Bot Detection Avoidance**: Human-like behavior simulation
- **⏱️ Rate Limiting**: Platform-specific limits to avoid account bans
- **📊 Notion Sync**: Automatically tracks all applications in your Notion database

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Brave Search API key (get one at https://brave.com/search/api/)

### Installation

```bash
# Clone the repository
git clone git@github.com:sumanthpn07/lazyApply.git
cd lazyApply

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Configure environment
cp .env.example .env
# Edit .env with your API keys
```

### Configuration

Edit `.env` file:

```env
BRAVE_API_KEY=your_brave_api_key
NOTION_DATABASE_ID=your_notion_database_id
PORT=3000
```

Edit `data/profile.json` with your details for auto-filling applications.

### Running

```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

Open http://localhost:3000 in your browser.

## Usage

1. **Search Jobs**: Enter job title and location, click "Search Jobs"
2. **Review**: Click "Review" to see job details before applying
3. **Select Jobs**: Check the jobs you want to apply to
4. **Apply**: Click "Apply Selected" to start automation
5. **Fill Info**: If additional info is required, fill the modal and submit
6. **Track**: View stats and sync to Notion

## Project Structure

```
lazyApply/
├── src/
│   ├── index.ts           # Express server entry
│   ├── config/            # Configuration
│   ├── services/          # Brave search, job store, profile
│   ├── api/               # API routes
│   ├── types/             # TypeScript interfaces
│   └── utils/             # Logger, rate limiter, anti-bot
├── public/                # Web UI
├── data/
│   ├── profile.json       # Your profile for auto-fill
│   ├── applied-jobs.json  # Local job cache
│   └── resumes/           # Resume PDFs
└── .env                   # Configuration
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/search` | Search jobs via Brave API |
| GET | `/api/jobs` | Get all job listings |
| POST | `/api/jobs/:id/apply` | Apply to a job |
| POST | `/api/jobs/:id/input` | Submit additional inputs |
| GET | `/api/profile` | Get user profile |
| GET | `/api/stats` | Get application statistics |

## Rate Limits

| Platform | Max/Hour | Daily Limit | Delay |
|----------|----------|-------------|-------|
| LinkedIn | 10 | 50 | 5-8 min |
| Lever | 20 | 100 | 2-4 min |
| Greenhouse | 20 | 100 | 2-4 min |
| Wellfound | 15 | 75 | 3-5 min |

## Safety Features

- **Rate Limiting**: Strict limits per platform
- **Human-like Behavior**: Random delays, realistic typing
- **Stealth Mode**: Avoid bot detection
- **User Control**: Pause/resume anytime

## License

MIT

## Author

P N Sumanth
- GitHub: [@sumanthpn07](https://github.com/sumanthpn07)
- LinkedIn: [pnsumanth](https://linkedin.com/in/pnsumanth)
