-- 0014_harden_audit_fn_execute.sql
-- Security hardening for the pricing audit trigger function introduced in
-- 0011_pricing_tiers.sql.
--
-- fn_pricing_tier_sets_audit() is a SECURITY DEFINER trigger function. Postgres
-- grants EXECUTE on new functions to PUBLIC by default, and PostgREST exposes any
-- public-schema function as a callable RPC (/rest/v1/rpc/fn_pricing_tier_sets_audit).
-- That means anon/authenticated could invoke this SECURITY DEFINER function directly
-- (Supabase advisors 0028/0029). It only ever needs to run as the AFTER INSERT
-- trigger on pricing_tier_sets, which fires as the function owner regardless of
-- EXECUTE grants -- so revoking EXECUTE from the client roles closes the RPC
-- escalation surface without affecting the audit trail (D-06 / T-03-02).
revoke execute on function public.fn_pricing_tier_sets_audit() from public;
revoke execute on function public.fn_pricing_tier_sets_audit() from anon;
revoke execute on function public.fn_pricing_tier_sets_audit() from authenticated;
