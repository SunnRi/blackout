const YASNO_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/yasno-api`;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function yasnoFetch(path: string, params?: Record<string, string>): Promise<unknown> {
  const u = new URL(`${YASNO_API_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, v);
    }
  }

  const resp = await fetch(u.toString(), {
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!resp.ok) throw new Error(`Yasno API error: ${resp.status}`);
  return resp.json();
}

export type YasnoRegion = {
  id: number;
  value: string;
  dsos: YasnoProvider[];
};

export type YasnoProvider = {
  id: number;
  name: string;
};

export type YasnoStreet = {
  id: number;
  name: string;
};

export type YasnoHouse = {
  id: number;
  name: string;
};

export type YasnoSlot = {
  start: number; // minutes from midnight
  end: number;
  type: string; // "Definite" | "NotPlanned"
};

export type YasnoPlannedOutages = Record<string, {
  today?: {
    date: string;
    status: string;
    slots: YasnoSlot[];
  };
  tomorrow?: {
    date: string;
    status: string;
    slots: YasnoSlot[];
  };
  updatedOn?: string;
}>;

export type YasnoProbableOutages = {
  [regionId: string]: {
    dsos: {
      [dsoId: string]: {
        groups: {
          [group: string]: {
            slots: {
              [weekday: string]: YasnoSlot[];
            };
          };
        };
      };
    };
  };
};

export type YasnoGroupResponse = {
  group: number;
  subgroup: number;
};

export async function fetchRegions(): Promise<YasnoRegion[]> {
  return yasnoFetch('/regions') as Promise<YasnoRegion[]>;
}

export async function fetchPlannedOutages(regionId: number, dsoId: number): Promise<YasnoPlannedOutages> {
  return yasnoFetch('/planned-outages', { regionId: String(regionId), dsoId: String(dsoId) }) as Promise<YasnoPlannedOutages>;
}

export async function fetchProbableOutages(regionId: number, dsoId: number): Promise<YasnoProbableOutages> {
  return yasnoFetch('/probable-outages', { regionId: String(regionId), dsoId: String(dsoId) }) as Promise<YasnoProbableOutages>;
}

export async function fetchStreets(regionId: number, dsoId: number, query: string): Promise<YasnoStreet[]> {
  return yasnoFetch('/streets', { regionId: String(regionId), dsoId: String(dsoId), query }) as Promise<YasnoStreet[]>;
}

export async function fetchHouses(regionId: number, dsoId: number, streetId: number, query: string): Promise<YasnoHouse[]> {
  return yasnoFetch('/houses', {
    regionId: String(regionId),
    dsoId: String(dsoId),
    streetId: String(streetId),
    query,
  }) as Promise<YasnoHouse[]>;
}

export async function fetchGroupByAddress(
  regionId: number,
  dsoId: number,
  streetId: number,
  houseId: number,
): Promise<YasnoGroupResponse> {
  return yasnoFetch('/group', {
    regionId: String(regionId),
    dsoId: String(dsoId),
    streetId: String(streetId),
    houseId: String(houseId),
  }) as Promise<YasnoGroupResponse>;
}

// Helper: convert minutes from midnight to "HH:MM"
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Helper: parse ISO date to Kyiv time minutes
export function dateToMinutes(dateStr: string): number {
  const date = new Date(dateStr);
  const kyivStr = date.toLocaleString('en-US', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hour12: false });
  const match = kyivStr.match(/(\d{2}):(\d{2})/);
  return match ? parseInt(match[1]) * 60 + parseInt(match[2]) : 0;
}
