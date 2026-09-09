import { inngest } from "./inngest";
import { requireDb } from "./db";
import { deleteRelayObject } from "./r2";

type RelayCleanupCandidate = {
  id: string;
  r2_key: string;
};

export const cleanupVerifiedRelayObjects = inngest.createFunction(
  {
    id: "cleanup-verified-r2-relay-objects",
    retries: 3,
  },
  { cron: "0 3 * * *" },
  async ({ step }) => {
    const candidates = await step.run("load-relay-cleanup-candidates", async () => {
      const sql = requireDb();
      const rows = await sql`
        select a.id, a.r2_key
        from assets a
        where a.type = 'GENERATED_VIDEO'
          and a.r2_key is not null
          and a.relay_deleted_at is null
          and a.relay_delete_after is not null
          and a.relay_delete_after <= now()
          and exists (
            select 1
            from asset_locations al
            where al.asset_id = a.id
              and al.status = 'verified'
              and al.verified_at is not null
          )
        order by a.relay_delete_after asc
        limit 100
      `;
      return Array.from(rows) as unknown as RelayCleanupCandidate[];
    });

    let deleted = 0;
    for (const candidate of candidates) {
      await step.run(`delete-relay-${candidate.id}`, async () => {
        await deleteRelayObject(candidate.r2_key);
        const sql = requireDb();
        await sql`
          update assets
          set relay_deleted_at = now()
          where id = ${candidate.id}
            and relay_deleted_at is null
        `;
      });
      deleted += 1;
    }

    return { scanned: candidates.length, deleted };
  },
);
