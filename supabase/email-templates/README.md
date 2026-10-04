# Auth email templates

Pasted by hand into Supabase: Authentication -> Email Templates. Nothing deploys these.

| Supabase template | File | Subject line |
|---|---|---|
| Confirm signup | confirm-signup.html | Confirm your email for Ezzy |
| Reset password | reset-password.html | Reset your Ezzy password |

Sender (Authentication -> SMTP Settings): Ezzy <hello@meetezzy.com>, sent through Resend.
`{{ .ConfirmationURL }}` and `{{ .Email }}` are Supabase template variables; leave them as written.
