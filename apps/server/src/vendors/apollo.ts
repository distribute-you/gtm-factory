/** Apollo, called directly with the platform key: people search (free) and person match (1 credit). */

import { UNIT_PRICES, type Meter } from "./meter";

const BASE = "https://api.apollo.io/api/v1";

function key(): string {
  const k = process.env.APOLLO_API_KEY;
  if (!k) throw new Error("APOLLO_API_KEY is not set");
  return k;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key(), "cache-control": "no-cache" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Apollo ${path} answered ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text.replace(/"request_id"\s*:\s*(-?\d+)/, '"request_id":"$1"')) as T;
}

export interface ApolloFilters {
  person_titles?: string[];
  person_seniorities?: string[];
  person_locations?: string[];
  organization_locations?: string[];
  organization_num_employees_ranges?: string[];
  q_organization_keyword_tags?: string[];
  q_keywords?: string;
}

export interface ApolloPerson {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  last_name_obfuscated?: string | null;
  title?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
  email_status?: string | null;
  organization?: { name?: string | null; primary_domain?: string | null; website_url?: string | null } | null;
}

/** People search: free (0 credits). Only people with a verified email on file. */
export async function searchPeople(filters: ApolloFilters, page: number, perPage = 25): Promise<{ people: ApolloPerson[]; total: number }> {
  const r = await post<{ people?: ApolloPerson[]; pagination?: { total_entries?: number }; total_entries?: number }>("mixed_people/api_search", {
    ...filters,
    contact_email_status: ["verified"],
    page,
    per_page: perPage,
  });
  return { people: r.people ?? [], total: r.pagination?.total_entries ?? r.total_entries ?? 0 };
}

/** Reveal one person (work email included): 1 credit when Apollo bills it. */
export async function matchPerson(personId: string, meter: Meter): Promise<ApolloPerson | null> {
  const r = await post<{ person?: ApolloPerson | null; credits_consumed?: number }>("people/match", {
    id: personId,
    reveal_personal_emails: false,
    run_waterfall_email: false,
  });
  const credits = typeof r.credits_consumed === "number" ? r.credits_consumed : r.person?.email ? 1 : 0;
  if (credits > 0) meter.add("Apollo", "people/match credit", credits, credits * UNIT_PRICES.apolloCredit);
  return r.person ?? null;
}
