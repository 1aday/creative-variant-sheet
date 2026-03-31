import type { SupabaseClient } from "@supabase/supabase-js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const CANDIDATE_TABLES = ["styles", "generated_images", "images", "user_credits"] as const;

let cachedGuestUserId: string | null = null;

const isUuid = (value: unknown): value is string => {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
};

export const resolveGuestUserId = async (supabase: SupabaseClient): Promise<string> => {
  if (cachedGuestUserId && isUuid(cachedGuestUserId)) {
    return cachedGuestUserId;
  }

  const configuredGuestUserId = process.env.NEXT_PUBLIC_GALLERY_USER_ID;
  if (isUuid(configuredGuestUserId)) {
    cachedGuestUserId = configuredGuestUserId.trim();
    return cachedGuestUserId;
  }

  for (const table of CANDIDATE_TABLES) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select("user_id")
        .not("user_id", "is", null)
        .limit(1);

      if (error || !Array.isArray(data) || data.length === 0) {
        continue;
      }

      const candidate = data[0]?.user_id;
      if (isUuid(candidate)) {
        cachedGuestUserId = candidate.trim();
        return cachedGuestUserId;
      }
    } catch {
      // Ignore lookup failures and continue to next candidate table.
    }
  }

  console.warn(
    "[guest-user-id] NEXT_PUBLIC_GALLERY_USER_ID is missing/invalid. Falling back to NIL UUID.",
  );
  cachedGuestUserId = NIL_UUID;
  return cachedGuestUserId;
};
