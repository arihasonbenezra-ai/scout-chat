-- One "Start over" per prep session (Practice / STAR / Mock) until the
-- full set of questions is completed. Tracked on the saved conversation
-- row so it survives a refresh; the client enforces it (restart_count and
-- answer_count are updated by the client alongside the messages it
-- already writes). Each restart is a new API call, so the limit is about
-- cost and about not letting people dodge every hard question.

alter table conversations
  add column if not exists restart_count int not null default 0,
  add column if not exists answer_count int not null default 0;
