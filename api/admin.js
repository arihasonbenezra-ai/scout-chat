// One admin function, two jobs by action: login (api/_admin-login.js) and
// grant (api/_admin-grant.js). They were separate functions until the
// deployment hit Vercel's twelve-function cap.
import login from './_admin-login.js';
import grant from './_admin-grant.js';

export default async function handler(req, res) {
  var action = req.body && req.body.action;
  if (action === 'login') return login(req, res);
  if (action === 'grant') return grant(req, res);
  return res.status(400).json({ error: 'action must be login or grant' });
}
