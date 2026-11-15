-- Social Studio AI assistant runs are recorded in the same cost ledger as the
-- console and department agents, under their own kind so Insights can show
-- them separately. Re-runnable: the constraint is dropped and re-added.
--
-- Rollback: delete rows with kind = 'social_assist', then restore the
-- original constraint ('console', 'delegation', 'standing_task').

alter table public.agent_runs drop constraint if exists agent_runs_kind_check;
alter table public.agent_runs
  add constraint agent_runs_kind_check
  check (kind in ('console', 'delegation', 'standing_task', 'social_assist'));
