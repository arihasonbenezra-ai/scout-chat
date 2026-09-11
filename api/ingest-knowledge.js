export const runtime = 'edge';

// Admin-only tool, not part of the product surface - there is no UI button
// for this. You (or a future small script) call it directly with a URL you
// have already decided is worth ingesting. It does not crawl, discover
// links, or run on a schedule; one call = one page.

const SUPABASE_URL = 'https://peksgdlfrnymkzlrbsgi.supabase.co';
const USER_AGENT = 'EzzyKnowledgeBot/0.1 (+https://meetezzy.com; contact: arib@senylabs.io)';
const MAX_CONTENT_CHARS = 15000;

const EXTRACT_KNOWLEDGE_SYSTEM = [
  'You are extracting structured career/hiring knowledge from a public web page for a career-coaching product.',
  '',
  'Extract only what the source material actually supports. Do not invent, generalize beyond the text, or add outside knowledge.',
  '',
  'For every item, set "status":',
  '- "fact": the source states this directly and objectively (e.g. "the interview has 5 rounds").',
  '- "inference": reasonably concluded from the source but not stated in those exact words.',
  '- "opinion": advice, a recommendation, or a subjective claim the source is making (e.g. "candidates should prepare X").',
  '',
  'category is one of: interview, recruiting, company, career.',
  '- interview: interview format, structure, what is evaluated, question types.',
  '- recruiting: resume/application advice, hiring signals, evaluation criteria.',
  '- company: facts about a specific company (strategy, products, culture, priorities).',
  '- career: roles, skills, career paths, industry trends.',
  '',
  'subject is the specific thing the item is about if there is one (a company name, a role name, e.g. "Google" or "Product Manager") - leave it null if the item is general.',
  'topic is a short free-text label for the sub-area, e.g. "interview_process", "product_sense", "resume_screening".',
  '',
  'Every item needs an evidence_quote: the exact phrase or sentence from the source it is based on.',
  'Extract at most 15 items. Prioritize the highest-signal, most reusable items over exhaustive coverage.',
  '',
  'Separately, if - and only if - the source describes actual interview questions along with what they evaluate, what a strong vs. weak answer looks like, or likely follow-ups, record those as "archetypes" instead of (or in addition to) plain items. Do not force content into an archetype if the source doesn\'t actually support that level of detail - leave archetypes empty rather than inventing evaluation criteria the source doesn\'t state.',
  'For each archetype: interview_type is a free-text label (e.g. behavioral, technical, product, leadership, case, system_design). role is the specific role it applies to if the source ties it to one, otherwise leave it null. Every archetype needs at least one real example_question drawn from or clearly implied by the source, and an evidence_quote grounding it in the text.'
].join('\n');

const EXTRACT_KNOWLEDGE_TOOL = {
  name: 'record_knowledge_items',
  description: 'Record structured knowledge items and/or question archetypes extracted from a source document.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: ['interview', 'recruiting', 'company', 'career'] },
            subject: { type: 'string' },
            topic: { type: 'string' },
            claim: { type: 'string' },
            status: { type: 'string', enum: ['fact', 'inference', 'opinion'] },
            confidence: { type: 'number' },
            evidence_quote: { type: 'string' }
          },
          required: ['category', 'claim', 'status', 'evidence_quote']
        }
      },
      archetypes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            interview_type: { type: 'string' },
            role: { type: 'string' },
            competency: { type: 'string' },
            title: { type: 'string' },
            example_questions: { type: 'array', items: { type: 'string' } },
            testing_for: { type: 'array', items: { type: 'string' } },
            strong_evidence: { type: 'array', items: { type: 'string' } },
            failure_modes: { type: 'array', items: { type: 'string' } },
            likely_followups: { type: 'array', items: { type: 'string' } },
            status: { type: 'string', enum: ['fact', 'inference', 'opinion'] },
            confidence: { type: 'number' },
            evidence_quote: { type: 'string' }
          },
          required: ['interview_type', 'competency', 'title', 'example_questions', 'evidence_quote']
        }
      }
    },
    required: ['items', 'archetypes']
  }
};

function stripHtml(html) {
  var text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

function extractTitle(html) {
  var m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1].trim().slice(0, 200) : null;
}

// Basic User-agent:* robots.txt check - not a full RFC 9309 parser. Good
// enough for "does this domain broadly disallow bots from this path",
// which is the only question a single hand-approved URL needs answered.
async function isAllowedByRobots(pageUrl) {
  var origin;
  try {
    origin = new URL(pageUrl).origin;
  } catch (e) {
    return false;
  }
  var path = new URL(pageUrl).pathname;
  try {
    var res = await fetch(origin + '/robots.txt', { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return true; // no robots.txt = no restriction stated
    var body = await res.text();
    var lines = body.split('\n').map(function (l) { return l.trim(); });
    var inWildcardGroup = false;
    var disallows = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^user-agent:/i.test(line)) {
        inWildcardGroup = /^user-agent:\s*\*/i.test(line);
      } else if (inWildcardGroup && /^disallow:/i.test(line)) {
        var rule = line.split(':').slice(1).join(':').trim();
        if (rule) disallows.push(rule);
      }
    }
    return !disallows.some(function (rule) { return path.indexOf(rule) === 0; });
  } catch (e) {
    return false; // fail closed - if we can't check, don't ingest
  }
}

async function anthropicExtract(userContent) {
  var res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 2000,
      system: EXTRACT_KNOWLEDGE_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
      tools: [EXTRACT_KNOWLEDGE_TOOL],
      tool_choice: { type: 'tool', name: 'record_knowledge_items' }
    })
  });
  var data = await res.json();
  var toolUse = (data.content || []).find(function (b) { return b.type === 'tool_use'; });
  return toolUse ? toolUse.input : null;
}

async function supabaseInsert(table, rows) {
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
      Prefer: 'return=representation'
    },
    body: JSON.stringify(rows)
  });
  if (!res.ok) {
    var errText = await res.text();
    throw new Error(table + ' insert failed: ' + res.status + ' ' + errText);
  }
  return res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var adminSecret = req.headers && (req.headers['x-admin-secret'] || req.headers['X-Admin-Secret']);
  if (!process.env.INGEST_SECRET || adminSecret !== process.env.INGEST_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var body = req.body || {};
    var url = typeof body.url === 'string' ? body.url : null;
    var sourceType = ['official_company_page', 'news', 'industry_guide', 'editorial', 'other'].indexOf(body.sourceType) !== -1
      ? body.sourceType : 'other';
    if (!url) return res.status(400).json({ error: 'url required' });

    var domain;
    try {
      domain = new URL(url).hostname;
    } catch (e) {
      return res.status(400).json({ error: 'Invalid url' });
    }

    var allowed = await isAllowedByRobots(url);
    if (!allowed) {
      return res.status(403).json({ error: 'robots_disallowed', detail: 'robots.txt disallows this path for general crawlers' });
    }

    var pageRes = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!pageRes.ok) {
      return res.status(502).json({ error: 'Could not fetch source', status: pageRes.status });
    }
    var html = await pageRes.text();
    var title = extractTitle(html);
    var content = stripHtml(html).slice(0, MAX_CONTENT_CHARS);
    if (!content) return res.status(422).json({ error: 'No extractable text content' });

    var extracted = await anthropicExtract(
      'Source: ' + (title || url) + '\nURL: ' + url + '\n\n' + content
    );
    var items = (extracted && Array.isArray(extracted.items)) ? extracted.items.slice(0, 15) : [];
    var validItems = items.filter(function (i) {
      return i && i.category && i.claim && i.status && i.evidence_quote;
    });
    var archetypes = (extracted && Array.isArray(extracted.archetypes)) ? extracted.archetypes.slice(0, 10) : [];
    var validArchetypes = archetypes.filter(function (a) {
      return a && a.interview_type && a.competency && a.title && Array.isArray(a.example_questions) && a.example_questions.length && a.evidence_quote;
    });

    var sourceRows = await supabaseInsert('knowledge_sources', [{
      url: url,
      title: title,
      domain: domain,
      source_type: sourceType,
      content: content,
      retrieved_at: new Date().toISOString()
    }]);
    var sourceId = sourceRows[0].id;

    var knowledgeRows = validItems.map(function (i) {
      return {
        source_id: sourceId,
        category: i.category,
        subject: i.subject ? String(i.subject).slice(0, 120) : null,
        topic: i.topic ? String(i.topic).slice(0, 120) : null,
        claim: String(i.claim).slice(0, 500),
        status: i.status,
        confidence: typeof i.confidence === 'number' ? i.confidence : null,
        evidence: [{ quote: String(i.evidence_quote).slice(0, 400) }]
      };
    });

    var inserted = knowledgeRows.length ? await supabaseInsert('knowledge_items', knowledgeRows) : [];

    var archetypeRows = validArchetypes.map(function (a) {
      return {
        source_id: sourceId,
        interview_type: String(a.interview_type).slice(0, 60),
        role: a.role ? String(a.role).slice(0, 120) : null,
        competency: String(a.competency).slice(0, 120),
        title: String(a.title).slice(0, 200),
        example_questions: a.example_questions.slice(0, 6).map(function (q) { return String(q).slice(0, 300); }),
        testing_for: (a.testing_for || []).slice(0, 8).map(String),
        strong_evidence: (a.strong_evidence || []).slice(0, 8).map(String),
        failure_modes: (a.failure_modes || []).slice(0, 8).map(String),
        likely_followups: (a.likely_followups || []).slice(0, 8).map(String),
        status: a.status || 'opinion',
        confidence: typeof a.confidence === 'number' ? a.confidence : null
      };
    });
    var insertedArchetypes = archetypeRows.length ? await supabaseInsert('question_archetypes', archetypeRows) : [];

    return res.status(200).json({ sourceId: sourceId, itemsSaved: inserted.length, archetypesSaved: insertedArchetypes.length });
  } catch (err) {
    return res.status(500).json({ error: 'Ingestion error', detail: err.message });
  }
}
