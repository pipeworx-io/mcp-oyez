interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Oyez SCOTUS MCP.
 *
 * Keyless US Supreme Court case data from the Oyez API (api.oyez.org):
 * case summaries, questions presented, decisions, vote breakdowns, advocates,
 * and oral-argument metadata, back to the 1700s. Source of truth for "how did
 * the Court rule and who voted which way."
 */


const BASE = 'https://api.oyez.org';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'search_cases',
    description:
      'Search US Supreme Court (SCOTUS) cases from Oyez by term year and/or case-name substring. Returns compact summaries with the question presented, description, and IDs for get_case. If neither term nor name is given, defaults to the most recent term. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        term: {
          type: 'number',
          description: 'SCOTUS term year, e.g. 2023 (the term that began Oct 2023). Optional.',
        },
        name: {
          type: 'string',
          description:
            'Case-name substring, filtered client-side, e.g. "Harvard", "Trump", "abortion". Optional.',
        },
        limit: { type: 'number', description: 'Max cases to return (default 15, max 30).' },
      },
    },
  },
  {
    name: 'get_case',
    description:
      'Get a full SCOTUS case from Oyez by term and docket number — question presented, facts, conclusion, decision (winning party, vote split, decision type), which justices were in the majority vs. dissent, advocates, and whether oral-argument audio exists. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        term: { type: 'number', description: 'SCOTUS term year, e.g. 2023.' },
        docket_number: {
          type: 'string',
          description: 'Docket number, e.g. "22-448" (CFPB v. Community Financial Services).',
        },
      },
      required: ['term', 'docket_number'],
    },
  },
  {
    name: 'cases_by_term',
    description:
      'List the SCOTUS cases for a given term year from Oyez — compact summaries (name, docket, citation, short question, oyez_url). Use to browse a full term. Keyless.',
    inputSchema: {
      type: 'object',
      properties: {
        term: { type: 'number', description: 'SCOTUS term year, e.g. 2022 or 2023.' },
        limit: { type: 'number', description: 'Max cases to return (default 20, max 40).' },
      },
      required: ['term'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'search_cases':
        return searchCases(args);
      case 'get_case':
        return getCase(args);
      case 'cases_by_term':
        return casesByTerm(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

// ---- helpers ----

function stripHtml(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s;
}

/** Oyez citation is an object {volume, page, year, href} or sometimes a string. */
function formatCitation(c: unknown): string | null {
  if (typeof c === 'string') return c || null;
  if (c && typeof c === 'object') {
    const o = c as Record<string, unknown>;
    if (typeof o.name === 'string' && o.name) return o.name;
    const vol = o.volume ? String(o.volume) : '';
    const page = o.page ? String(o.page) : '___';
    const year = o.year ? ` (${o.year})` : '';
    if (vol) return `${vol} U.S. ${page}${year}`.trim();
    if (o.year) return `(${o.year})`;
  }
  return null;
}

async function oyezGet(path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
  });
  if (res.status === 404) return { __notFound: true };
  if (!res.ok) return { __error: `Oyez: ${res.status} ${(await res.text()).slice(0, 200)}` };
  return res.json();
}

function nameOf(x: unknown): string | undefined {
  if (x && typeof x === 'object') {
    const n = (x as Record<string, unknown>).name;
    if (typeof n === 'string') return n;
  }
  return undefined;
}

/** Compact summary shape used by search_cases and cases_by_term. */
function mapCaseSummary(raw: Record<string, unknown>): Record<string, unknown> {
  const term = raw.term != null ? String(raw.term) : '';
  const docket = typeof raw.docket_number === 'string' ? raw.docket_number : '';
  return {
    id: raw.ID,
    name: raw.name,
    docket_number: docket || null,
    citation: formatCitation(raw.citation),
    term: term || null,
    question: truncate(stripHtml(raw.question), 300),
    description: typeof raw.description === 'string' ? raw.description : null,
    oyez_url: term && docket ? `https://www.oyez.org/cases/${term}/${docket}` : null,
    href: typeof raw.href === 'string' ? raw.href : null,
  };
}

// ---- tools ----

async function fetchTermCases(term: number, perPage: number): Promise<Array<Record<string, unknown>>> {
  const data = await oyezGet(
    `/cases?filter=term:${encodeURIComponent(String(term))}&per_page=${perPage}`,
  );
  if (data && typeof data === 'object' && '__error' in data) throw new Error(String((data as Record<string, unknown>).__error));
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

const CURRENT_TERM = 2024; // most recent term with data; falls back gracefully

async function searchCases(args: Record<string, unknown>): Promise<unknown> {
  const term = typeof args.term === 'number' ? args.term : undefined;
  const nameFilter = typeof args.name === 'string' ? args.name.trim().toLowerCase() : '';
  const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 30);

  const effectiveTerm = term ?? CURRENT_TERM;
  // Pull a generous page so client-side name filtering has material to work with.
  const pool = await fetchTermCases(effectiveTerm, nameFilter ? 200 : limit);

  let cases = pool;
  if (nameFilter) {
    cases = cases.filter((c) => String(c.name ?? '').toLowerCase().includes(nameFilter));
  }
  cases = cases.slice(0, limit);

  return {
    term: effectiveTerm,
    name_filter: nameFilter || null,
    count: cases.length,
    cases: cases.map(mapCaseSummary),
  };
}

async function casesByTerm(args: Record<string, unknown>): Promise<unknown> {
  const term = typeof args.term === 'number' ? args.term : Number(args.term);
  if (!Number.isFinite(term)) return { error: 'provide a numeric term year, e.g. 2023', term: args.term ?? null };
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 40);

  const cases = (await fetchTermCases(term, limit)).slice(0, limit);
  return {
    term,
    count: cases.length,
    cases: cases.map((c) => {
      const s = mapCaseSummary(c) as Record<string, unknown>;
      return {
        name: s.name,
        docket_number: s.docket_number,
        citation: s.citation,
        question: truncate(String(s.question ?? ''), 200),
        oyez_url: s.oyez_url,
      };
    }),
  };
}

async function getCase(args: Record<string, unknown>): Promise<unknown> {
  const term = typeof args.term === 'number' ? args.term : Number(args.term);
  const docket = typeof args.docket_number === 'string' ? args.docket_number.trim() : '';
  if (!Number.isFinite(term) || !docket) {
    return { error: 'provide term (number) and docket_number (e.g. "22-448")', term: args.term ?? null, docket_number: args.docket_number ?? null };
  }

  const data = await oyezGet(`/cases/${encodeURIComponent(String(term))}/${encodeURIComponent(docket)}`);
  if (data && typeof data === 'object' && '__notFound' in data) {
    return { error: 'case not found', term, docket_number: docket };
  }
  if (data && typeof data === 'object' && '__error' in data) {
    return { error: String((data as Record<string, unknown>).__error) };
  }
  const c = data as Record<string, unknown>;

  // Decision (Oyez exposes an array; the merits decision is the first entry).
  const decisions = Array.isArray(c.decisions) ? (c.decisions as Array<Record<string, unknown>>) : [];
  const dec = decisions[0];

  let decision: Record<string, unknown> | null = null;
  const justicesMajority: string[] = [];
  const justicesDissent: string[] = [];
  if (dec) {
    decision = {
      winning_party: dec.winning_party ?? null,
      majority_vote: dec.majority_vote ?? null,
      minority_vote: dec.minority_vote ?? null,
      decision_type: dec.decision_type ?? null,
      description: truncate(stripHtml(dec.description), 500),
    };
    const votes = Array.isArray(dec.votes) ? (dec.votes as Array<Record<string, unknown>>) : [];
    for (const v of votes) {
      const member = nameOf(v.member);
      if (!member) continue;
      if (v.vote === 'majority') justicesMajority.push(member);
      else if (v.vote === 'minority') justicesDissent.push(member);
    }
  }

  const advocates = Array.isArray(c.advocates) ? (c.advocates as Array<Record<string, unknown>>) : [];
  const oralAudio = Array.isArray(c.oral_argument_audio)
    ? (c.oral_argument_audio as Array<Record<string, unknown>>)
    : [];

  // heard_by is an array of court objects; decided_by is a single object.
  const heardBy = Array.isArray(c.heard_by)
    ? (c.heard_by as unknown[]).map(nameOf).filter(Boolean)
    : nameOf(c.heard_by)
      ? [nameOf(c.heard_by)]
      : [];

  return {
    id: c.ID,
    name: c.name,
    citation: formatCitation(c.citation),
    term: c.term != null ? String(c.term) : null,
    docket_number: c.docket_number ?? docket,
    question: truncate(stripHtml(c.question), 500),
    facts: truncate(stripHtml(c.facts_of_the_case), 800),
    conclusion: truncate(stripHtml(c.conclusion), 800),
    decision,
    justices_majority: justicesMajority.length ? justicesMajority : null,
    justices_dissent: justicesDissent.length ? justicesDissent : null,
    heard_by: heardBy.length ? heardBy : null,
    decided_by: nameOf(c.decided_by) ?? null,
    advocates: advocates.length
      ? advocates.map((a) => ({
          name: nameOf(a.advocate) ?? null,
          role: typeof a.advocate_description === 'string' ? a.advocate_description : null,
        }))
      : null,
    has_oral_argument_audio: oralAudio.some((a) => a && a.unavailable !== true),
    justia_url: typeof c.justia_url === 'string' ? c.justia_url : null,
    oyez_url: `https://www.oyez.org/cases/${term}/${docket}`,
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
