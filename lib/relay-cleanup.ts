import { inngest } from "./inngest";
import { requireDb } from "./db";
import { deleteRelayObject } from "./r2";

type RelayCleanupCandidate = {
  id: string;
  r2_key: string;
};

const activeExtensionStatuses = [
  "queued",
  "submitting",
  "provider_pending",
  "downloading_from_provider",
  "uploading_relay",
  "failed_retryable",
];

export const cleanupVerifiedRelayObjects = inngest.createFunction(
  {
    id: "cleanup-verified-r2-relay-objects",
    name: "Cleanup verified R2 relay objects",
    triggers: { cron: "0 3 * * *" },
    retries: 3,
  },
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
          and not exists (
            select 1
            from generation_job_assets gja
            join generation_jobs gj on gj.id = gja.generation_job_id
            where gja.asset_id = a.id
              and gja.role = 'extension_source'
              and gj.status = any(${activeExtensionStatuses})
          )
        order by a.relay_delete_after asc
        limit 100
      `;
      return Array.from(rows) as unknown as RelayCleanupCandidate[];
    });

    let deleted = 0;
    for (const candidate of candidates) {
      const didDelete = await step.run(`delete-relay-${candidate.id}`, async () => {
        const sql = requireDb();
        return sql.begin(async (tx) => {
          // Re-check under a row lock. A new extension may have been queued after
          // the initial candidate scan, and that source must remain in R2.
          const stillEligible = await tx`
            select a.id, a.r2_key
            from assets a
            where a.id = ${candidate.id}
              and a.type = 'GENERATED_VIDEO'
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
              and not exists (
                select 1
                from generation_job_assets gja
                join generation_jobs gj on gj.id = gja.generation_job_id
                where gja.asset_id = a.id
                  and gja.role = 'extension_source'
                  and gj.status = any(${activeExtensionStatuses})
              )
            for update
          `;

          if (!stillEligible[0]) return false;
          await deleteRelayObject(String(stillEligible[0].r2_key));
          await tx`
            update assets
            set relay_deleted_at = now()
            where id = ${candidate.id}
              and relay_deleted_at is null
          `;
          return true;
        });
      });
      if (didDelete) deleted += 1;
    }

    return { scanned: candidates.length, deleted };
  },
);
