/**
 * Fictional people and companies for the simulated leads. Every name is made up and drawn from
 * the lead's id, so a lead keeps its name and company across reloads. Leads that share a brand,
 * a country and a company size are spread over a small pool of companies, so a company holds
 * several people, the way a real account does.
 */

import type { SimLead } from "@gtm-factory/engine";
import { hashString } from "@/components/mark";

const FIRST = ["Ava", "Liam", "Noor", "Mateo", "Ines", "Owen", "Sofia", "Ravi", "Lena", "Hugo", "Maya", "Felix", "Zoe", "Arjun", "Clara", "Theo", "Amara", "Jonas", "Elif", "Marco", "Nadia", "Oscar", "Priya", "Leo", "Iris", "Samir", "Hana", "Pablo", "Freya", "Malik"];
const LAST = ["Moreau", "Becker", "Okafor", "Lindqvist", "Rossi", "Tanaka", "Novak", "Haddad", "Silva", "Kowalski", "Dubois", "Meyer", "Nguyen", "Fischer", "Costa", "Larsen", "Varga", "Ahmed", "Keller", "Romero", "Brennan", "Sato", "Petrov", "Laine", "Duarte"];
const CO_A = ["Blue", "North", "Silver", "Bright", "Clear", "Oak", "Swift", "Stone", "Maple", "Iron", "Coral", "Amber", "Cedar", "Lark", "Pine", "Sun", "River", "Fern", "Echo", "Atlas"];
const CO_B = ["field", "gate", "line", "works", "path", "point", "bridge", "craft", "loop", "yard", "forge", "harbor", "nest", "grid", "wave", "stack"];
const CO_C = ["Systems", "Labs", "Group", "Partners", "Studio", "Logistics", "Health", "Software", "Foods", "Capital", "Clinics", "Freight"];
const TITLES: Record<string, string[]> = {
  founder: ["Founder", "Co-founder", "Founder and CEO"],
  head: ["Head of Operations", "Head of Growth", "Head of Sales", "VP Operations"],
  manager: ["Operations Manager", "Marketing Manager", "Sales Manager", "Office Manager"],
};

const pick = <T,>(list: readonly T[], h: number): T => list[h % list.length]!;

export function personName(lead: SimLead): string {
  const h = hashString(lead.id);
  return `${pick(FIRST, h)} ${pick(LAST, Math.floor(h / 31))}`;
}

export function personTitle(lead: SimLead): string {
  return pick(TITLES[lead.attributes.seniority ?? "manager"] ?? TITLES.manager!, hashString(`${lead.id}:t`));
}

/** The company key a lead belongs to. */
export function companyKey(lead: SimLead): string {
  const slot = hashString(`${lead.id}:c`) % 40;
  return `${lead.brandId}|${lead.attributes.country ?? ""}|${lead.attributes.company_size ?? ""}|${slot}`;
}

export function companyName(key: string): string {
  const h = hashString(key);
  return `${pick(CO_A, h)}${pick(CO_B, Math.floor(h / 23))} ${pick(CO_C, Math.floor(h / 389))}`;
}

export function initials(name: string): string {
  return (
    name
      .split(/[\s&.-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
