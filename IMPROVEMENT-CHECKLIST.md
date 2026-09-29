# Improvement Checklist - Rashid HQ OS

This is an actionable checklist generated from the project review. Check off items as you complete them.

---

## 🔴 Critical (Do This Week)

### 1. Fix Test Suite
- [ ] Delete `node_modules` and `package-lock.json`
  ```bash
  rm -rf node_modules package-lock.json
  ```
- [ ] Reinstall dependencies
  ```bash
  npm install
  # OR try pnpm/bun if npm fails on Windows
  pnpm install
  ```
- [ ] Verify tests run successfully
  ```bash
  npm test
  ```
- [ ] Document any Windows-specific setup in README

### 2. Fix TypeCheck/Lint Timeouts
- [ ] Test locally with verbose output
  ```bash
  npm run typecheck 2>&1 | tee typecheck.log
  npm run lint 2>&1 | tee lint.log
  ```
- [ ] Increase timeout in CI workflow (`.github/workflows/ci.yml`)
  ```yaml
  timeout-minutes: 10  # increase from 5
  ```
- [ ] Consider incremental builds or `turbo`

### 3. Clean Up Git Status
- [ ] Review unstaged changes
  ```bash
  git diff next.config.ts
  git diff package.json
  git diff scripts/migrate.mjs
  git diff src/instrumentation.ts
  ```
- [ ] Stage new files
  ```bash
  git add .github/workflows/migrations.yml
  git add src/lib/env/auth-secret.ts
  git add tests/auth-secret.test.ts
  ```
- [ ] Commit changes
  ```bash
  git commit -m "fix: improve build validation and add migration CI"
  ```

---

## 🟡 High Priority (This Month)

### 4. Security Hardening
- [ ] Add HSTS header to `src/proxy.ts`
  ```typescript
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload'
  ```
- [ ] Run dependency audit
  ```bash
  npm audit
  npm audit fix
  ```
- [ ] Create `SECURITY.md`
  ```markdown
  # Security Policy
  ## Reporting a Vulnerability
  Email: security@alkingenterprises.com
  Response time: 48 hours
  ```

### 5. Increase Test Coverage
- [ ] Add tests for policy engine
  ```typescript
  // tests/policy.test.ts
  describe('Policy Engine', () => {
    it('should require approval for delete_project', () => {
      // ...
    });
  });
  ```
- [ ] Add tests for key components
  - [ ] `src/components/ceo-console.tsx`
  - [ ] `src/components/access-manager.tsx`
  - [ ] `src/lib/mcp/executor.ts`
- [ ] Add API route tests
  - [ ] `src/app/api/mcp/route.ts`
  - [ ] `src/app/api/console/route.ts`
- [ ] Target 70%+ coverage
  ```bash
  npm test -- --coverage
  ```

### 6. Code Refactoring
- [ ] Split `src/lib/mcp/tools.ts` (736 lines)
  ```
  src/lib/mcp/tools/
  ├── index.ts          # exports all tools
  ├── projects.ts       # list/get/register/update/delete
  ├── categories.ts     # list_categories
  ├── departments.ts    # list/delegate
  ├── skills.ts         # list_skills/get_skill
  └── project-tools.ts  # add/update/delete/call_project_tool
  ```
- [ ] Extract magic numbers to constants
  ```typescript
  // src/lib/constants.ts
  export const MAX_RATE_LIMIT_KEYS = 5000;
  export const DEFAULT_LOG_RETENTION_DAYS = 90;
  export const DEFAULT_TOKEN_EXPIRY_DAYS = 90;
  ```

### 7. Add Health Check Endpoint
- [ ] Create `src/app/api/health/route.ts`
  ```typescript
  import { NextResponse } from 'next/server';
  import { getServiceSupabase } from '@/lib/supabase/server';
  import { Redis } from '@upstash/redis';
  
  export async function GET() {
    const checks = {
      status: 'healthy',
      database: 'unknown',
      redis: 'unknown',
      timestamp: new Date().toISOString()
    };
    
    // Check database
    try {
      const supabase = getServiceSupabase();
      await supabase.from('projects').select('count').limit(1);
      checks.database = 'connected';
    } catch {
      checks.database = 'disconnected';
      checks.status = 'unhealthy';
    }
    
    // Check Redis (if configured)
    try {
      if (process.env.KV_REST_API_URL) {
        const redis = new Redis({
          url: process.env.KV_REST_API_URL,
          token: process.env.KV_REST_API_TOKEN!
        });
        await redis.ping();
        checks.redis = 'connected';
      } else {
        checks.redis = 'not_configured';
      }
    } catch {
      checks.redis = 'disconnected';
    }
    
    return NextResponse.json(checks, {
      status: checks.status === 'healthy' ? 200 : 503
    });
  }
  ```
- [ ] Test endpoint
  ```bash
  curl http://localhost:7070/api/health
  ```

---

## 🟢 Medium Priority (Next 3 Months)

### 8. Performance Optimization
- [ ] Add caching for projects
  ```typescript
  // src/lib/cache.ts
  const projectCache = new Map<string, { data: Project; expiry: number }>();
  
  export function getCachedProject(id: string) {
    const cached = projectCache.get(id);
    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }
    return null;
  }
  ```
- [ ] Review slow queries
  ```sql
  -- Run in Supabase SQL editor
  EXPLAIN ANALYZE 
  SELECT * FROM agent_logs 
  WHERE project_id = '...' 
  ORDER BY created_at DESC 
  LIMIT 50;
  ```
- [ ] Add missing indexes if needed
- [ ] Consider partitioning `agent_logs` by month

### 9. Documentation
- [ ] Add OpenAPI/Swagger for MCP endpoints
  ```bash
  npm install swagger-jsdoc swagger-ui-express
  ```
- [ ] Create `docs/ARCHITECTURE.md`
  - System overview diagram
  - Request flow
  - Database schema
  - Security model
- [ ] Create `docs/ADRs/` folder
  - ADR-001: Why MCP over REST?
  - ADR-002: Why Supabase over raw Postgres?
  - ADR-003: Why Groq for AI?
- [ ] Create `CONTRIBUTING.md`
  - Development setup
  - Code style guide
  - PR process
  - Testing requirements

### 10. Monitoring & Observability
- [ ] Add Prometheus metrics
  ```typescript
  // src/app/api/metrics/route.ts
  import { NextResponse } from 'next/server';
  
  let requestCount = 0;
  let errorCount = 0;
  
  export async function GET() {
    const metrics = `
  # HELP http_requests_total Total HTTP requests
  # TYPE http_requests_total counter
  http_requests_total ${requestCount}
  
  # HELP http_errors_total Total HTTP errors
  # TYPE http_errors_total counter
  http_errors_total ${errorCount}
    `.trim();
    
    return new NextResponse(metrics, {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
  ```
- [ ] Add structured logging
  ```typescript
  // src/lib/logger.ts
  export function logInfo(message: string, meta?: Record<string, any>) {
    console.log(JSON.stringify({ level: 'info', message, ...meta, timestamp: new Date() }));
  }
  ```
- [ ] Set up alerting in Vercel/Sentry
  - Error rate > 5%
  - Response time > 2s
  - Database connection failures

### 11. Database Improvements
- [ ] Add missing foreign key constraints
  ```sql
  -- Review and add as needed
  ALTER TABLE agent_logs
  ADD CONSTRAINT fk_agent_logs_project
  FOREIGN KEY (project_id) REFERENCES projects(id)
  ON DELETE CASCADE;
  ```
- [ ] Create composite indexes for common queries
  ```sql
  CREATE INDEX idx_agent_logs_project_created 
  ON agent_logs(project_id, created_at DESC);
  ```
- [ ] Document retention policy for `agent_runs`
  - Currently only `agent_logs` has 90-day retention
  - Should `agent_runs` have the same?

---

## 🔵 Nice to Have (Future)

### 12. Developer Experience
- [ ] Add pre-commit hooks
  ```bash
  npm install --save-dev husky lint-staged
  npx husky install
  ```
- [ ] Add commit message linting
  ```bash
  npm install --save-dev @commitlint/cli @commitlint/config-conventional
  ```
- [ ] Create development environment with Docker Compose
  ```yaml
  # docker-compose.yml
  version: '3.8'
  services:
    postgres:
      image: postgres:15
      environment:
        POSTGRES_PASSWORD: postgres
      ports:
        - "5432:5432"
    redis:
      image: redis:7
      ports:
        - "6379:6379"
  ```

### 13. Feature Enhancements
- [ ] Add webhook replay mechanism (for failed deliveries)
- [ ] Add bulk operations for projects (import/export CSV)
- [ ] Add dashboard customization (drag-and-drop widgets)
- [ ] Add mobile app (React Native?)

### 14. Internationalization
- [ ] Add more languages (French, German, Spanish?)
- [ ] Extract all hardcoded strings to translation files
- [ ] Use `next-intl` or similar library

---

## 📊 Progress Tracking

**Total Tasks:** 50+  
**Critical:** 3  
**High Priority:** 4  
**Medium Priority:** 4  
**Nice to Have:** 3

### Weekly Review
- [ ] Week 1: Complete critical tasks
- [ ] Week 2: Complete high priority tasks
- [ ] Month 1: Complete medium priority tasks
- [ ] Quarter 1: Consider nice-to-have features

---

## ✅ Completion Criteria

- [ ] All tests pass (100% success rate)
- [ ] Test coverage ≥ 70%
- [ ] No critical security vulnerabilities (`npm audit`)
- [ ] TypeCheck completes in < 30s
- [ ] Lint completes in < 20s
- [ ] All critical and high-priority items checked off
- [ ] Documentation updated (README, ARCHITECTURE)
- [ ] Health check endpoint returns 200
- [ ] Production deployment successful

---

**Last Updated:** September 27, 2026  
**Next Review:** October 4, 2026
