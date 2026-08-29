-- À exécuter APRÈS avoir ajouté les 3 secrets dans Edge Functions > Secrets.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid)
from cron.job
where jobname = 'mdl-push-reminders';

select cron.schedule(
  'mdl-push-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://xbahkwumedkpyismcvcr.supabase.co/functions/v1/push-reminders',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret','Dyep7gqJ_CHRr2YWtI-v5ZyTQ8Zdv9b_9juT0KJn2j8'
    ),
    body := '{}'::jsonb
  );
  $$
);
