-- Budget exhaustion alert (follows 0018). Until now a department that hit
-- 100% of monthly_token_budget was blocked silently: a budget_events 'blocked'
-- row was written, but the owners were only ever mailed at 80%. So the first
-- sign of a blocked standing task was the digest reporting a failure.
--
-- This stamp throttles the 100% mail to one a day per department, separately
-- from budget_alerted_at (80%): crossing 80% in the morning must not suppress
-- the "runs are now blocked" mail that afternoon.
--
-- Deliberately NOT added: a denormalized current_month_spend counter. The
-- agent_runs ledger (0016) is the single source of truth and is summed on
-- demand (src/lib/budgets.ts); a counter maintained next to it can drift under
-- concurrent runs or a failed increment, and a budget gate reading a drifted
-- number is worse than one that is a few milliseconds slower.
--
-- Re-runnable: guarded column add. Rollback: see docs/DATABASE.md.

alter table public.departments
  add column if not exists budget_exhausted_alerted_at timestamptz;
