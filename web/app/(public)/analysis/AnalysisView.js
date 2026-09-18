"use client";

import { StackedArea, Lorenz, DivergingBars, TierBars, seriesColor } from "@/app/components/charts";
import { useTableState, SortHeader, FilterBar, TableScroll } from "@/app/components/DataTable";
import Pager from "@/app/components/Pager";
import EmptyState from "@/app/components/EmptyState";
import AnalysisNav from "./AnalysisNav";

// Everything on /analysis, top to bottom. One long scrolling report (see
// AnalysisNav) rather than a ?s= tab switcher — the whole dataset is one
// cheap combined fetch (page.js), meant to be read start to finish, not
// navigated between independently-expensive tabs the way a ?s=-switched desk is.
export default function AnalysisView({
  summary,
  byCharacter,
  byTierPower,
  byPointsPower,
  coverage,
  byFamily,
  byTier,
  byTurn,
  concentration,
  rejected,
  rejectedByTurn,
  onceEver,
  freeform,
  raw,
}) {
  return (
    <div className="flex flex-col gap-6">
      <AnalysisNav />
      <Summary summary={summary} />
      <ByCharacter rows={byCharacter} />
      <MostPowerful byTier={byTierPower} byPoints={byPointsPower} />
      <Coverage coverage={coverage} />
      <ByFamily data={byFamily} />
      <ByTier data={byTier} />
      <OverTime data={byTurn} />
      <Concentration data={concentration} />
      <Rejected data={rejected} byTurn={rejectedByTurn} />
      <OnceEver rows={onceEver} />
      <Freeform data={freeform} />
      <RawClaims rows={raw} />
    </div>
  );
}

function Section({ id, title, lede, children }) {
  return (
    <section id={id} className="ops-section ops-section--wide">
      <div className="ops-section-head">
        <h2 className="section-title">{title}</h2>
        {lede ? <p className="ops-lede">{lede}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className="panel" style={{ padding: "0.75rem 1rem", minWidth: "10rem" }}>
      <div className="text-xs text-muted">{label}</div>
      <div className="mono text-lg">{value}</div>
      {sub ? <div className="text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

function Summary({ summary: s }) {
  return (
    <Section id="summary" title="Summary" lede="The whole Desire economy, at a glance.">
      <div className="flex flex-wrap gap-4">
        <Tile label="Fulfilled claims" value={s.totalFulfilled} />
        <Tile
          label="Catalog coverage"
          value={`${s.coveragePct}%`}
          sub={`${s.uniqueTemplatesClaimed} of ${s.catalogSize} templates`}
        />
        <Tile label="Points awarded" value={s.totalPointsAwarded} />
        <Tile label="Avg points / claim" value={s.avgPointsPerClaim} />
        <Tile label="Most active" value={s.mostActiveCharacter?.name ?? "—"} sub={s.mostActiveCharacter ? `${s.mostActiveCharacter.count} claims` : null} />
        <Tile label="Most claimed" value={s.mostClaimedTemplate?.name ?? "—"} sub={s.mostClaimedTemplate ? `${s.mostClaimedTemplate.count} claims` : null} />
      </div>
    </Section>
  );
}

function ByCharacter({ rows }) {
  return (
    <Section id="by-character" title="Desires by person" lede="Claim count and points earned, per character.">
      {rows.length === 0 ? (
        <EmptyState>No fulfilled claims yet.</EmptyState>
      ) : (
        <TableScroll>
          <thead>
            <tr>
              <th>Character</th>
              <th>Claims</th>
              <th>Points</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.characterId}>
                <td>{r.name}</td>
                <td className="mono">{r.claimCount}</td>
                <td className="mono">{r.totalPoints}</td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
    </Section>
  );
}

function PowerTable({ title, rows, pointsColumn }) {
  return (
    <div className="panel" style={{ padding: "1rem", flex: "1 1 20rem" }}>
      <h3 className="text-sm text-muted" style={{ marginBottom: "0.5rem" }}>
        {title}
      </h3>
      {rows.length === 0 ? (
        <EmptyState>Nothing claimed yet.</EmptyState>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Desire</th>
              <th>Tier</th>
              <th>Claims</th>
              {pointsColumn ? <th>Points</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.templateId}>
                <td>{r.name}</td>
                <td className="mono">{r.tier}</td>
                <td className="mono">{r.claimCount}</td>
                {pointsColumn ? <td className="mono">{r.totalPoints}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MostPowerful({ byTier, byPoints }) {
  return (
    <Section
      id="most-powerful"
      title="Most powerful desires"
      lede="Two different questions: which claimed desires carry the highest tier, and which have awarded the most points in total."
    >
      <div className="flex flex-wrap gap-4">
        <PowerTable title="Highest tier, actually claimed" rows={byTier} />
        <PowerTable title="Most total points awarded" rows={byPoints} pointsColumn />
      </div>
    </Section>
  );
}

function Coverage({ coverage }) {
  const mostClaimed = coverage.all.slice(0, 40);
  const neverClaimed = coverage.all.filter((t) => t.claimCount === 0 && !t.retired);
  return (
    <Section
      id="coverage"
      title="Popularity & catalog coverage"
      lede={`${coverage.neverClaimedCount} of ${coverage.all.length} templates have never been claimed.`}
    >
      <div className="flex flex-wrap gap-4" style={{ alignItems: "flex-start" }}>
        <div className="panel" style={{ padding: "1rem", flex: "1 1 20rem" }}>
          <h3 className="text-sm text-muted" style={{ marginBottom: "0.5rem" }}>
            Most claimed
          </h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Desire</th>
                <th>Tier</th>
                <th>Claims</th>
              </tr>
            </thead>
            <tbody>
              {mostClaimed.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.name}
                    {t.retired ? <span className="text-muted"> (retired)</span> : null}
                  </td>
                  <td className="mono">{t.tier}</td>
                  <td className="mono">{t.claimCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel" style={{ padding: "1rem", flex: "1 1 20rem" }}>
          <h3 className="text-sm text-muted" style={{ marginBottom: "0.5rem" }}>
            Never claimed ({neverClaimed.length})
          </h3>
          {neverClaimed.length === 0 ? (
            <EmptyState>Every non-retired template has been claimed at least once.</EmptyState>
          ) : (
            <div style={{ maxHeight: "20rem", overflowY: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Desire</th>
                    <th>Tier</th>
                  </tr>
                </thead>
                <tbody>
                  {neverClaimed.map((t) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td className="mono">{t.tier}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function ByFamily({ data }) {
  const max = Math.max(1, ...data.byFamily.map((f) => f.claimCount));
  return (
    <Section
      id="by-family"
      title="Family distribution"
      lede="A claim can belong to more than one family, so these counts can add up to more than the total fulfilled claim count — that's expected, not a bug."
    >
      {data.byFamily.length === 0 ? (
        <EmptyState>No fulfilled claims yet.</EmptyState>
      ) : (
        <div className="panel flex flex-col gap-2" style={{ padding: "1rem" }}>
          {data.byFamily.map((f, i) => (
            <div key={f.key} className="flex items-center gap-3">
              <div className="text-sm" style={{ width: "10rem", flexShrink: 0 }}>
                {f.name}
              </div>
              <div style={{ flex: 1, background: "var(--field-bg)", borderRadius: "var(--r-sm)", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${Math.max(2, Math.round((f.claimCount / max) * 100))}%`,
                    background: f.color || seriesColor(i),
                    height: "0.9rem",
                  }}
                />
              </div>
              <div className="mono text-sm" style={{ width: "6rem", textAlign: "right" }}>
                {f.claimCount} claims
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function ByTier({ data }) {
  const bars = data.byTier.map((t) => ({ label: `T${t.tier}`, count: t.count }));
  return (
    <Section
      id="by-tier"
      title="Tier distribution"
      lede="Tier 6 is deliberately never used in the catalog — its bar always reads zero."
    >
      <div className="panel" style={{ padding: "1rem" }}>
        <TierBars bars={bars} />
        {data.otherCount > 0 && (
          <p className="text-xs text-muted" style={{ marginTop: "0.5rem" }}>
            {data.otherCount} claim{data.otherCount === 1 ? "" : "s"} carry an awarded point value outside 1–7 (a GM
            re-score), not shown above.
          </p>
        )}
      </div>
    </Section>
  );
}

function OverTime({ data }) {
  return (
    <Section id="over-time" title="Claims over time" lede="Fulfilled claims by turn, stacked by awarded tier.">
      <div className="panel" style={{ padding: "1rem" }}>
        <StackedArea series={data.series} categories={data.categories} title="Fulfilled Desire claims by tier" />
      </div>
    </Section>
  );
}

function Concentration({ data }) {
  return (
    <Section
      id="concentration"
      title="Points concentration"
      lede="How evenly Desire-earned points are spread across characters. 0 is perfectly even, 1 is one character holding all of it."
    >
      <div className="panel" style={{ padding: "1rem", maxWidth: "24rem" }}>
        <Lorenz points={data.lorenz} gini={data.gini} title="Desire points earned" />
      </div>
    </Section>
  );
}

function Rejected({ data, byTurn }) {
  return (
    <Section
      id="rejected"
      title="Rejected claims"
      lede="Desires GMs cancel most often — a separate lens; these never count toward the balance charts above."
    >
      <div className="panel" style={{ padding: "1rem" }}>
        <h3 className="text-sm text-muted" style={{ marginBottom: "0.5rem" }}>
          Fulfilled vs. cancelled by turn
        </h3>
        <DivergingBars
          points={byTurn}
          title="Fulfilled versus cancelled desire claims"
          positiveLabel="Fulfilled"
          negativeLabel="Cancelled"
        />
      </div>

      <div className="panel" style={{ padding: "1rem" }}>
        <h3 className="text-sm text-muted" style={{ marginBottom: "0.5rem" }}>
          Highest cancel rate
        </h3>
        {data.rows.length === 0 ? (
          <EmptyState>Nothing has ever been rejected.</EmptyState>
        ) : (
          <TableScroll>
            <thead>
              <tr>
                <th>Desire</th>
                <th>Fulfilled</th>
                <th>Cancelled</th>
                <th>Cancel rate</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.templateId}>
                  <td>{r.name}</td>
                  <td className="mono">{r.fulfilledCount}</td>
                  <td className="mono">{r.cancelledCount}</td>
                  <td className="mono">{r.cancelRate}%</td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        )}
        {data.reviewers.length > 0 && (
          <p className="text-xs text-muted" style={{ marginTop: "0.5rem" }}>
            Reviewed by {data.reviewers.length} GM{data.reviewers.length === 1 ? "" : "s"}.
          </p>
        )}
      </div>
    </Section>
  );
}

function OnceEver({ rows }) {
  return (
    <Section id="once-ever" title="Once-per-life exhaustion" lede="Templates flagged onceEver — how many characters have claimed each, ever.">
      {rows.length === 0 ? (
        <EmptyState>No once-per-life templates in the catalog.</EmptyState>
      ) : (
        <TableScroll>
          <thead>
            <tr>
              <th>Desire</th>
              <th>Tier</th>
              <th>Claimed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="mono">{r.tier}</td>
                <td className="mono">{r.claimedCount}</td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
    </Section>
  );
}

function Freeform({ data }) {
  return (
    <Section
      id="freeform"
      title="Freeform / off-catalog claims"
      lede={`${data.count} claim${data.count === 1 ? "" : "s"} with no catalog template — GM-granted, no tier or family to group by.`}
    >
      {data.count === 0 ? (
        <EmptyState>None — every claim traces back to a catalog template.</EmptyState>
      ) : (
        <TableScroll>
          <thead>
            <tr>
              <th>Character</th>
              <th>Text</th>
              <th>Points</th>
              <th>Status</th>
              <th>Turn</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.characterName}</td>
                <td>{r.text}</td>
                <td className="mono">{r.points}</td>
                <td>{r.status}</td>
                <td className="mono">{r.setTurnNumber ?? "—"}</td>
                <td>{r.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
      )}
    </Section>
  );
}

const RAW_CLAIMS_FILTER_DEFS = [
  { key: "status", label: "Status", value: (r) => r.status },
  { key: "tier", label: "Tier", value: (r) => r.tier ?? "freeform" },
];

function RawClaims({ rows }) {
  const table = useTableState({
    rows,
    searchFields: [(r) => r.characterName, (r) => r.text, (r) => r.reason ?? "", (r) => (r.families ?? []).join(" ")],
    filterDefs: RAW_CLAIMS_FILTER_DEFS,
    initialSort: { key: "setTurnNumber", dir: "desc" },
    pageSize: 50,
  });

  return (
    <Section id="raw" title="Full claims table" lede="Every claim ever, including cancelled and legacy rows. Search covers character, desire name, family and reason.">
      <FilterBar
        filterDefs={RAW_CLAIMS_FILTER_DEFS}
        filters={table.filters}
        setFilters={table.setFilters}
        options={table.options}
        query={table.query}
        setQuery={table.setQuery}
        searchLabel="Search"
        searchPlaceholder="Character, desire, family, reason…"
      />
      {table.pageRows.length === 0 ? (
        <EmptyState>No claims match this filter.</EmptyState>
      ) : (
        <>
          <TableScroll minWidth={900}>
            <thead>
              <tr>
                <SortHeader label="Turn" sortKey="setTurnNumber" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="Character" sortKey="characterName" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="Desire" sortKey="text" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="Tier" sortKey="tier" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="Points" sortKey="points" sort={table.sort} onSort={table.toggleSort} />
                <SortHeader label="Status" sortKey="status" sort={table.sort} onSort={table.toggleSort} />
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {table.pageRows.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.setTurnNumber ?? "—"}</td>
                  <td>{r.characterName}</td>
                  <td>{r.text}</td>
                  <td className="mono">{r.tier ?? "—"}</td>
                  <td className="mono">{r.points}</td>
                  <td>{r.status}</td>
                  <td>{r.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
          <Pager page={table.page} totalPages={table.totalPages} total={table.total} unit="claims" onPage={table.setPage} />
        </>
      )}
    </Section>
  );
}
